// GET /api/auth/me — the current user, or 401.
import { ok } from "@/lib/http";
import { requireUser } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, error } = await requireUser();
  if (error) return error;
  return ok({ user: user.toSafeJSON() });
}
