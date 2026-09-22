// DELETE /api/keys/:id — permanently remove a key. Only a REVOKED key may be
// deleted (so a live integration can't be destroyed by accident).
import { ok, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth/guards";
import { loadKeyForUser, deleteKey } from "@/lib/services/apiKeyService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  const { user, error } = await requireUser();
  if (error) return error;
  const { id } = await params;
  const { key, notFound } = await loadKeyForUser(user, id);
  if (notFound) return fail("NOT_FOUND", "API key not found.");
  try {
    await deleteKey(key);
  } catch (e) {
    return fail(e.code || "CONFLICT", e.message || "Could not delete the key.");
  }
  return ok({ id });
}
