// POST /api/auth/logout — clears the session cookie.
import { ok } from "@/lib/http";
import { clearedCookie } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = ok({ loggedOut: true });
  const c = clearedCookie();
  res.cookies.set(c.name, c.value, c.options);
  return res;
}
