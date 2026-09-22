// GET /api/v1/keyinfo — Phase-1 API-key auth probe.
//
// This is the machine-facing surface: it authenticates via API key (Bearer),
// requires the files:read scope, and returns a safe summary of the key +
// project. It exists so the API-key pipeline (verify / scope / project status)
// can be exercised end-to-end before the real file endpoints arrive in Phase 2.
// It NEVER echoes the secret.
import { ok } from "@/lib/http";
import { authenticateApiKey } from "@/lib/apiKeyAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const { key, project, error } = await authenticateApiKey(request, "files:read");
  if (error) return error;
  return ok({
    project: { id: String(project._id), name: project.name, status: project.status },
    key: { id: String(key._id), name: key.name, env: key.env, scopes: key.scopes, keyPrefix: key.keyPrefix },
    message: "API key is valid and authorized (files:read).",
  });
}
