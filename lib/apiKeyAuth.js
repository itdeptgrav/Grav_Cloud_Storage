// lib/apiKeyAuth.js
// Authentication + authorization for the PUBLIC /api/v1 surface (machine
// callers using an API key). Returns { key, project } on success, or
// { error } (a ready-to-return Response) otherwise.
//
// Order of checks matters: a valid credential is confirmed first, then project
// status, then scope — so error codes are precise and never leak more than
// needed.

import { connectDB } from "@/lib/db/mongoose";
import Project from "@/lib/db/models/Project";
import { verifyApiKey, touchKeyUsage } from "@/lib/services/apiKeyService";
import { fail } from "@/lib/http";

export function extractBearer(request) {
  const h = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export async function authenticateApiKey(request, requiredScope) {
  const raw = extractBearer(request);
  if (!raw) {
    return { error: fail("MISSING_API_KEY", "Provide an API key: 'Authorization: Bearer gsk_...'.") };
  }

  const res = await verifyApiKey(raw);
  if (!res.ok) {
    if (res.reason === "API_KEY_REVOKED") {
      return { error: fail("API_KEY_REVOKED", "This API key has been revoked.") };
    }
    return { error: fail("INVALID_API_KEY", "The supplied API key is invalid.") };
  }

  const key = res.key;
  await connectDB();
  const project = await Project.findById(key.projectId);
  if (!project || project.status !== "active") {
    return { error: fail("PROJECT_DISABLED", "The project for this API key is not active.") };
  }

  if (requiredScope && !key.scopes.includes(requiredScope)) {
    return {
      error: fail("INSUFFICIENT_SCOPE", `This API key is missing the required scope: ${requiredScope}.`),
    };
  }

  // Best-effort usage stamps — must never fail the actual request (§21).
  touchKeyUsage(key);
  Project.updateOne({ _id: project._id }, { $inc: { "counters.requests": 1 } })
    .exec()
    .catch(() => {});

  return { key, project };
}
