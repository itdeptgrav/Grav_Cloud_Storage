// GET /api/v1/keyinfo — API-key auth probe (requires files:read). Never echoes
// the secret. Now also rate-limited + logged like every other v1 endpoint.
import { ok } from "@/lib/http";
import { withLog } from "@/lib/apiLog";
import { authenticateApiKey } from "@/lib/apiKeyAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLog("keyinfo", async (request) => {
  const { key, project, error } = await authenticateApiKey(request, "files:read");
  if (error) return error;
  return ok({
    project: { id: String(project._id), name: project.name, status: project.status },
    key: { id: String(key._id), name: key.name, env: key.env, scopes: key.scopes, keyPrefix: key.keyPrefix },
    message: "API key is valid and authorized (files:read).",
  });
});
