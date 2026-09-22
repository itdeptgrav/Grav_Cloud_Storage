// lib/http.js
// One consistent response contract for the whole API.
//   success: { success: true,  data: {...} }
//   error:   { success: false, error: { code, message } }
// Binary/streaming endpoints (Phase 2) return raw bytes instead — never wrapped.

import { NextResponse } from "next/server";

// Stable, machine-readable error codes → HTTP status.
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  MISSING_API_KEY: 401,
  INVALID_API_KEY: 401,
  API_KEY_REVOKED: 401,
  FORBIDDEN: 403,
  INSUFFICIENT_SCOPE: 403,
  PROJECT_DISABLED: 403,
  ACCOUNT_DISABLED: 403,
  SIGNUP_DISABLED: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  SETUP_ALREADY_DONE: 409,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,

  // Phase 2 — storage API
  FILE_NOT_FOUND: 404,
  INVALID_UPLOAD: 400,
  FILE_TOO_LARGE: 413,
  INVALID_RANGE: 416,
  STORAGE_UNAVAILABLE: 503,

  // Phase 4 — production controls
  STORAGE_QUOTA_EXCEEDED: 507,
  INSUFFICIENT_STORAGE: 507,
  RATE_LIMIT_EXCEEDED: 429,
  TOO_MANY_CONCURRENT_TRANSFERS: 429,
  INTEGRITY_ERROR: 500,
};

export function ok(data = {}, { status = 200, headers } = {}) {
  return NextResponse.json({ success: true, data }, { status, headers });
}

export function fail(code, message, { status, details } = {}) {
  const httpStatus = status || ERROR_STATUS[code] || 400;
  const body = { success: false, error: { code, message } };
  if (details) body.error.details = details;
  return NextResponse.json(body, { status: httpStatus });
}

/** Wrap a route handler so an unexpected throw becomes a clean 500 (never a
 *  stack trace or a leaked secret in the response). */
export function handler(fn) {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      // Log server-side only; never echo internals to the client.
      console.error("[api] unhandled error:", e?.message);
      return fail("INTERNAL", "Something went wrong.");
    }
  };
}
