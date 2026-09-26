// lib/http.js
// One consistent response contract for the whole API.
//   success: { success: true,  data: {...} }
//   error:   { success: false, error: { code, message } }
// Binary/streaming endpoints (Phase 2) return raw bytes instead — never wrapped.

import { NextResponse } from "next/server";
import { logError } from "@/lib/logSafe";

// Stable, machine-readable error codes → HTTP status.
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  MISSING_API_KEY: 401,
  INVALID_API_KEY: 401,
  API_KEY_REVOKED: 401,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
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

  // Chunked uploads (lib/chunkedUploads.js). Stable, documented codes.
  UPLOAD_SESSION_NOT_FOUND: 404,
  UPLOAD_SESSION_FORBIDDEN: 403,
  UPLOAD_SESSION_EXPIRED: 410,
  UPLOAD_SESSION_CLOSED: 409, // completed, aborted or failed — cannot take more chunks
  UPLOAD_FINALIZING: 409, // complete already running for this session
  BAD_CHUNK_INDEX: 409, // not the next expected chunk (response says which is)
  CHUNK_IN_PROGRESS: 409, // an attempt at this chunk is still being written
  CHUNK_CONFLICT: 409, // a DIFFERENT chunk was already accepted at this index
  CHUNK_SIZE_MISMATCH: 400,
  CHUNK_INTERRUPTED: 400, // the chunk body stopped arriving (network/abort)
  CHUNK_CHECKSUM_MISMATCH: 422,
  SIZE_MISMATCH: 422, // complete called before every byte was accepted
  CHECKSUM_MISMATCH: 422,
  UPLOAD_DATA_MISSING: 409, // the session's temp data is gone

  // Permanent project deletion (lib/services/projectDeletion.js).
  PROJECT_DELETING: 409, // the project is being permanently deleted — nothing new is accepted
  PROJECT_DELETE_IN_PROGRESS: 409, // another request is deleting this project right now
  PROJECT_DELETE_FAILED: 500, // a stage failed; the project stays "deleting" and the delete can be retried
  CONFIRMATION_MISMATCH: 400, // the typed project name / acknowledgement did not match
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

/** The request's URL path, for log lines (no query string: it may carry tokens). */
function routeOf(req) {
  try {
    return new URL(req.url).pathname;
  } catch {
    return undefined;
  }
}

/** Wrap a route handler so an unexpected throw becomes a clean 500 (never a
 *  stack trace or a leaked secret in the response). */
export function handler(fn) {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      // Log server-side only (path-free); never echo internals to the client.
      logError("api", { method: req?.method, route: routeOf(req) }, e);
      return fail("INTERNAL", "Something went wrong.");
    }
  };
}
