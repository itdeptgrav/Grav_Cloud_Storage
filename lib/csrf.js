// lib/csrf.js — CSRF guard for the SESSION (cookie) plane, enforced at the
// ROUTE layer (Node runtime).
//
// Why not middleware? Next.js truncates request bodies at ~10 MiB for ANY route
// matched by middleware/proxy (in both the edge AND nodejs runtimes) — a silent
// data-loss bug for a storage API. So CSRF cannot live in middleware here; it is
// called explicitly at the top of every state-changing session handler instead:
//
//   const csrf = csrfGuard(request); if (csrf) return csrf;
//
// Rules (identical to the old middleware logic):
//   • Only call this from SESSION-plane mutations (POST/PUT/PATCH/DELETE).
//   • NEVER call it from Bearer /api/v1 routes — machine clients have no Origin
//     or ambient cookie, so they have no CSRF vector and must keep working.
//   • Block only on an Origin/Referer that MISMATCHES the Host. If both are
//     absent (a non-browser client), allow — a browser cannot suppress Origin on
//     a cross-site unsafe request, so this does not weaken real protection.
import { fail } from "@/lib/http";

function sameHost(urlStr, host) {
  try {
    return new URL(urlStr).host === host;
  } catch {
    return false;
  }
}

/** @returns a 403 CSRF_FAILED Response to return, or null when the request is allowed. */
export function csrfGuard(request) {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  let blocked = false;
  if (origin) blocked = !sameHost(origin, host);
  else if (referer) blocked = !sameHost(referer, host);
  if (blocked) return fail("CSRF_FAILED", "Cross-origin request blocked.");
  return null;
}
