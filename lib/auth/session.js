// lib/auth/session.js
// Dashboard (human) sessions: a signed JWT in an httpOnly cookie.
//
// Signing/verifying uses `jose` (pure JS, works in Node and Edge). Cookies are
// READ with next/headers cookies(); they are WRITTEN by attaching the cookie
// descriptor to the NextResponse in the route handler (the reliable pattern in
// Route Handlers), via sessionCookie()/clearedCookie().

import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import config from "@/lib/config";

export const SESSION_COOKIE = "gs_session";
const TTL_SECONDS = 7 * 24 * 60 * 60;

const encoder = new TextEncoder();
function key() {
  if (!config.jwtSecret) throw new Error("JWT_SECRET is not set — cannot sign/verify sessions.");
  return encoder.encode(config.jwtSecret);
}

const baseCookieOptions = {
  httpOnly: true, // not readable by JS
  secure: config.isProd, // HTTPS-only in production; false on http://localhost
  sameSite: "lax", // sensible default against CSRF for a dashboard
  path: "/",
};

export async function signSession(user) {
  return new SignJWT({ role: user.role, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user._id || user.id))
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key());
}

/** Cookie descriptor for a fresh session — apply with res.cookies.set(...). */
export function sessionCookie(token) {
  return { name: SESSION_COOKIE, value: token, options: { ...baseCookieOptions, maxAge: TTL_SECONDS } };
}

/** Cookie descriptor that clears the session. */
export function clearedCookie() {
  return { name: SESSION_COOKIE, value: "", options: { ...baseCookieOptions, maxAge: 0 } };
}

/** Read + verify the current session. Returns { id, role, email } or null. */
export async function readSession() {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, key());
    return { id: payload.sub, role: payload.role, email: payload.email };
  } catch {
    return null;
  }
}
