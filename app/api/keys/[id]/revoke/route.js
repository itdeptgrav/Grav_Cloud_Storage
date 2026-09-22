// POST /api/keys/:id/revoke — revoke a key. Idempotent. Historical usage stays.
import { ok, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth/guards";
import { loadKeyForUser, revokeKey } from "@/lib/services/apiKeyService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const { user, error } = await requireUser();
  if (error) return error;
  const { id } = await params;
  const { key, notFound } = await loadKeyForUser(user, id);
  if (notFound) return fail("NOT_FOUND", "API key not found.");
  await revokeKey(key);
  return ok({ key: key.toNode() });
}
