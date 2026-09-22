// POST /api/auth/logout — clears the session cookie.
import { ok } from "@/lib/http";
import { clearedCookie } from "@/lib/auth/session";
import { csrfGuard } from "@/lib/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const csrf = csrfGuard(request);
  if (csrf) return csrf;
  const res = ok({ loggedOut: true });
  const c = clearedCookie();
  res.cookies.set(c.name, c.value, c.options);
  return res;
}
