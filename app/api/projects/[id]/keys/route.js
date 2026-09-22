// /api/projects/:id/keys
//   GET  → list keys for the project (masked; never the secret)
//   POST → create a key; the RAW secret is returned exactly ONCE here
import { ok, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth/guards";
import { getProjectForUser } from "@/lib/services/projectService";
import { createApiKey, listKeysForProject } from "@/lib/services/apiKeyService";
import { recordAudit } from "@/lib/services/auditService";
import { ipOf } from "@/lib/apiLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadProject(request, params) {
  const { user, error } = await requireUser();
  if (error) return { error };
  const { id } = await params;
  const { project, notFound } = await getProjectForUser(user, id);
  if (notFound) return { error: fail("NOT_FOUND", "Project not found.") };
  return { user, project };
}

export async function GET(request, { params }) {
  const { project, error } = await loadProject(request, params);
  if (error) return error;
  const keys = await listKeysForProject(project._id);
  return ok({ keys: keys.map((k) => k.toNode()) });
}

export async function POST(request, { params }) {
  const { user, project, error } = await loadProject(request, params);
  if (error) return error;

  let body = {};
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_ERROR", "Invalid JSON body.");
  }

  try {
    const { record, rawKey } = await createApiKey(project, {
      name: body.name,
      env: body.env,
      scopes: body.scopes,
      createdByUserId: user._id,
    });
    recordAudit({ user, action: "key.create", targetType: "apiKey", targetId: String(record._id), projectId: project._id, details: { name: record.name, env: record.env, scopes: record.scopes }, ip: ipOf(request) });
    // rawKey is returned ONCE. It is never stored and never logged.
    return ok({ key: record.toNode(), secret: rawKey }, { status: 201 });
  } catch (e) {
    return fail(e.code || "VALIDATION_ERROR", e.message || "Could not create the API key.");
  }
}
