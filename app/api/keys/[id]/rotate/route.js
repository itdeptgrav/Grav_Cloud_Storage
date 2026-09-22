// POST /api/keys/:id/rotate — SAFE rotation.
// Mints a NEW key (same env/scopes) linked to the old one and returns its raw
// secret ONCE. The OLD key stays ACTIVE so a running integration keeps working;
// revoke it explicitly after deploying the new one.
import { ok, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth/guards";
import { loadKeyForUser, rotateKey } from "@/lib/services/apiKeyService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const { user, error } = await requireUser();
  if (error) return error;
  const { id } = await params;
  const { key, notFound } = await loadKeyForUser(user, id);
  if (notFound) return fail("NOT_FOUND", "API key not found.");
  if (key.status === "revoked") return fail("CONFLICT", "Cannot rotate a revoked key.");

  const { record, rawKey, oldKeyId } = await rotateKey(key, { createdByUserId: user._id });
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
