// POST /api/keys/:id/revoke — revoke a key. Idempotent. Historical usage stays.
import { ok, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth/guards";
import { loadKeyForUser, revokeKey } from "@/lib/services/apiKeyService";
import { recordAudit } from "@/lib/services/auditService";
import { ipOf } from "@/lib/apiLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const { user, error } = await requireUser();
  if (error) return error;
  const { id } = await params;
  const { key, project, notFound } = await loadKeyForUser(user, id);
  if (notFound) return fail("NOT_FOUND", "API key not found.");
  await revokeKey(key);
  recordAudit({ user, action: "key.revoke", targetType: "apiKey", targetId: String(key._id), projectId: project?._id, details: { name: key.name }, ip: ipOf(request) });
  return ok({ key: key.toNode() });
}
