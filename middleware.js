// middleware.js — intentionally a NO-OP for the API.
//
// CSRF protection for the session (cookie) plane USED to live here, but Next.js
// silently truncates request bodies at ~10 MiB for ANY route matched by
// middleware/proxy (confirmed in both the edge AND nodejs runtimes) — a silent
// data-loss bug for an upload API. So the matcher below deliberately EXCLUDES
// /api/*: no API request is ever routed through this layer.
//
// CSRF is now enforced at the route layer instead — see lib/csrf.js, called at
// the top of every state-changing session handler. Bearer /api/v1 is unaffected
// (machine clients have no Origin/cookie → no CSRF vector).
//
// Nothing on the page (non-API) routes needs middleware today; this stays a
// documented pass-through so the exclusion above is explicit and discoverable.
import { NextResponse } from "next/server";

export function middleware() {
  return NextResponse.next();
}

export const config = {
  // Everything EXCEPT /api/* (and Next internals/static assets).
  matcher: ["/((?!api/|_next/|favicon.ico).*)"],
};
