// POST /api/keys/:id/rotate — SAFE rotation.
// Mints a NEW key (same env/scopes) linked to the old one and returns its raw
// secret ONCE. The OLD key stays ACTIVE so a running integration keeps working;
// revoke it explicitly after deploying the new one.
import { ok, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth/guards";
import { loadKeyForUser, rotateKey } from "@/lib/services/apiKeyService";
import { recordAudit } from "@/lib/services/auditService";
import { ipOf } from "@/lib/apiLog";
import { csrfGuard } from "@/lib/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const csrf = csrfGuard(request);
  if (csrf) return csrf;
  const { user, error } = await requireUser();
  if (error) return error;
  const { id } = await params;
  const { key, project, notFound } = await loadKeyForUser(user, id);
  if (notFound) return fail("NOT_FOUND", "API key not found.");
  if (project.status === "deleting") return fail("PROJECT_DELETING", "This project is being permanently deleted.");
  if (key.status === "revoked") return fail("CONFLICT", "Cannot rotate a revoked key.");

  let rotated;
  try {
    rotated = await rotateKey(key, { createdByUserId: user._id });
  } catch (e) {
    return fail(e.code || "INTERNAL", e.code ? e.message : "Could not rotate the key.");
  }
  const { record, rawKey, oldKeyId } = rotated;
  recordAudit({ user, action: "key.rotate", targetType: "apiKey", targetId: oldKeyId, projectId: key.projectId, details: { newKeyId: String(record._id) }, ip: ipOf(request) });
  return ok(
    {
      key: record.toNode(),
      secret: rawKey, // shown ONCE
      rotatedFrom: oldKeyId,
      note: "The previous key is still active. Revoke it once the new key is deployed.",
    },
    { status: 201 },
  );
}
