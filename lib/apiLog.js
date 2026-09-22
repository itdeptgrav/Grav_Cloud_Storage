// lib/apiLog.js
// withLog() wraps a route handler so EVERY request is logged uniformly (after
// it completes) without buffering the response — logging never blocks streaming
// (plan §28). Handlers attach context via setLogCtx(request, {...}); the wrapper
// reads it post-handler. A thrown handler becomes a clean 500 (no stack leak).
import { randomUUID } from "node:crypto";
import { fail } from "@/lib/http";
import { recordRequest } from "@/lib/services/logService";

export function ipOf(request) {
  const h = request.headers;
  const fwd = (h.get("x-forwarded-for") || "").split(",")[0].trim();
  return fwd || h.get("x-real-ip") || "";
}

export function setLogCtx(request, fields) {
  request._logCtx = { ...(request._logCtx || {}), ...fields };
}

/** Build a 429 response with safe standard rate-limit headers. */
export function rateLimitResponse(rl) {
  const res = fail("RATE_LIMIT_EXCEEDED", "Rate limit exceeded. Please retry shortly.");
  res.headers.set("Retry-After", String(Math.max(1, Math.ceil(rl.retryAfterMs / 1000))));
  res.headers.set("X-RateLimit-Limit", String(rl.limit));
  res.headers.set("X-RateLimit-Remaining", String(rl.remaining));
  res.headers.set("X-RateLimit-Reset", String(Math.ceil(rl.resetAt / 1000)));
  return res;
}

export function withLog(operation, handler) {
  return async (request, ctx) => {
    const t0 = process.hrtime.bigint();
    // One id per request, for log correlation + the SDK error. Set on the
    // response header here (not in middleware, which must not touch streams).
    const requestId = request.headers.get("x-request-id") || randomUUID();
    let response;
    try {
      response = await handler(request, ctx);
    } catch (e) {
      console.error(`[route ${operation}] unhandled:`, e?.message);
      setLogCtx(request, { errorCode: "INTERNAL" });
      response = fail("INTERNAL", "Something went wrong.");
    }
    try {
      response.headers?.set?.("X-Request-ID", requestId);
    } catch {
      /* immutable headers on some responses — ignore */
    }
    try {
      const lc = request._logCtx || {};
      const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
      const bytesIn = Number(request.headers.get("content-length") || 0);
      const bytesOut = Number(response.headers?.get?.("content-length") || 0);
      recordRequest({
        requestId,
        actorType: lc.actorType || "anon",
        projectId: lc.projectId || null,
        apiKeyId: lc.apiKeyId || null,
        keyPrefix: lc.keyPrefix || "",
        userId: lc.userId || null,
        actorLabel: lc.actorLabel || "",
        method: request.method,
        operation,
        fileId: lc.fileId || null,
        status: response.status,
        durationMs,
        bytesIn,
        bytesOut,
        errorCode: lc.errorCode || null,
        ip: ipOf(request),
      });
    } catch {
      /* logging must never break the response */
    }
    return response;
  };
}
