// lib/apiKeyAuth.js
// Authentication + authorization + RATE LIMITING for the PUBLIC /api/v1 surface.
// Returns { key, project } on success, or { error } (a ready Response). Also
// populates the request log context (setLogCtx) for the withLog wrapper.
//
// Check order: credential → rate limit → project status → scope, so error codes
// are precise and never leak more than needed.
import { connectDB } from "@/lib/db/mongoose";
import Project from "@/lib/db/models/Project";
import { verifyApiKey, touchKeyUsage } from "@/lib/services/apiKeyService";
import { fail } from "@/lib/http";
import { apiRateLimit } from "@/lib/limits";
import { setLogCtx, rateLimitResponse, ipOf } from "@/lib/apiLog";

export function extractBearer(request) {
  const h = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export async function authenticateApiKey(request, requiredScope) {
  const ip = ipOf(request);
  const raw = extractBearer(request);
  if (!raw) {
    setLogCtx(request, { actorType: "api", errorCode: "MISSING_API_KEY" });
    return { error: fail("MISSING_API_KEY", "Provide an API key: 'Authorization: Bearer gsk_...'.") };
  }

  const res = await verifyApiKey(raw);
  if (!res.ok) {
    const code = res.reason === "API_KEY_REVOKED" ? "API_KEY_REVOKED" : "INVALID_API_KEY";
    setLogCtx(request, { actorType: "api", errorCode: code });
    // Rate-limit failed attempts by IP to blunt key-guessing floods.
    const rl = apiRateLimit(`ip:${ip}`);
    if (!rl.ok) {
      setLogCtx(request, { actorType: "api", errorCode: "RATE_LIMIT_EXCEEDED" });
      return { error: rateLimitResponse(rl) };
    }
    return {
      error: code === "API_KEY_REVOKED"
        ? fail("API_KEY_REVOKED", "This API key has been revoked.")
        : fail("INVALID_API_KEY", "The supplied API key is invalid."),
    };
  }

  const key = res.key;

  // Rate limit primarily by API key.
  const rl = apiRateLimit(String(key._id));
  if (!rl.ok) {
    setLogCtx(request, { actorType: "api", apiKeyId: key._id, keyPrefix: key.keyPrefix, errorCode: "RATE_LIMIT_EXCEEDED" });
    return { error: rateLimitResponse(rl) };
  }

  await connectDB();
  const project = await Project.findById(key.projectId);
  if (!project || project.status !== "active") {
    setLogCtx(request, { actorType: "api", apiKeyId: key._id, keyPrefix: key.keyPrefix, projectId: key.projectId, errorCode: "PROJECT_DISABLED" });
    return { error: fail("PROJECT_DISABLED", "The project for this API key is not active.") };
  }

  if (requiredScope && !key.scopes.includes(requiredScope)) {
    setLogCtx(request, { actorType: "api", apiKeyId: key._id, keyPrefix: key.keyPrefix, projectId: project._id, actorLabel: key.name, errorCode: "INSUFFICIENT_SCOPE" });
    return { error: fail("INSUFFICIENT_SCOPE", `This API key is missing the required scope: ${requiredScope}.`) };
  }

  setLogCtx(request, { actorType: "api", apiKeyId: key._id, keyPrefix: key.keyPrefix, projectId: project._id, actorLabel: key.name });

  // Best-effort usage stamps — never fail the request (§21).
  touchKeyUsage(key);
  Project.updateOne({ _id: project._id }, { $inc: { "counters.requests": 1 } }).exec().catch(() => {});

  return { key, project };
}
