// lib/limits.js
// In-process rate limiting (fixed window) + concurrency slots. Single-node V1:
// state lives in this process. A multi-instance deployment would move this to a
// shared store (Redis) — the call sites would not change. Documented limitation.
import config from "@/lib/config";

// ── Rate limiter (fixed window) ──────────────────────────────────────────────
const buckets = new Map(); // key -> { count, resetAt }

function hit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  const remaining = Math.max(0, limit - b.count);
  const retryAfterMs = b.resetAt - now;
  return { ok: b.count <= limit, remaining, resetAt: b.resetAt, retryAfterMs, limit };
}

export function apiRateLimit(identity) {
  const { requests, windowMs } = config.apiRateLimit;
  return hit(`api:${identity}`, requests, windowMs);
}
export function authRateLimit(identity) {
  const { requests, windowMs } = config.authRateLimit;
  return hit(`auth:${identity}`, requests, windowMs);
}

// Periodically drop stale buckets so the map cannot grow unbounded. unref so it
// never keeps the process alive.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
}, 60000);
if (sweep.unref) sweep.unref();

// ── Concurrency slots (per project, per kind) ────────────────────────────────
const slots = new Map(); // `${kind}:${projectId}` -> count

function limitFor(kind) {
  return kind === "upload" ? config.maxConcurrentUploadsPerProject : config.maxConcurrentDownloadsPerProject;
}

/**
 * Try to take a transfer slot. Returns { ok, release }. `release` is idempotent
 * and MUST be called on every exit path (success, error, disconnect) — callers
 * put it in finally / the stream's onServed.
 */
export function acquireSlot(kind, projectId) {
  const key = `${kind}:${String(projectId)}`;
  const limit = limitFor(kind);
  const cur = slots.get(key) || 0;
  if (cur >= limit) return { ok: false, limit };
  slots.set(key, cur + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const n = (slots.get(key) || 1) - 1;
    if (n <= 0) slots.delete(key);
    else slots.set(key, n);
  };
  return { ok: true, release, limit };
}
