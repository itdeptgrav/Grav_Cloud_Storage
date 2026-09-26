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
  pruneHeld(); // expired chunked-upload leases stop counting against the limit
  const key = `${kind}:${String(projectId)}`;
  const limit = limitFor(kind);
  const cur = slots.get(key) || 0;
  if (cur >= limit) return { ok: false, limit };
  slots.set(key, cur + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    decrement(key);
  };
  return { ok: true, release, limit };
}

function decrement(key) {
  const n = (slots.get(key) || 1) - 1;
  if (n <= 0) slots.delete(key);
  else slots.set(key, n);
}

// ── Held slots: long-lived leases for chunked-upload sessions ────────────────
// A chunked upload occupies an upload slot from begin until complete / abort /
// expiry — in the SAME pool as single-shot uploads, so the per-project limit is
// one combined limit. Each lease carries the session's expiry and is dropped
// lazily once that passes (no timer). Leases are process memory; after a
// restart the chunk module rebuilds them from the persisted sessions
// (rehydrate), so accounting recovers without leaking.
const held = new Map(); // leaseKey (uploadId) -> { key, expiresAt }
let heldRehydrated = false;

function pruneHeld(now = Date.now()) {
  for (const [leaseKey, h] of held) {
    if (h.expiresAt <= now) {
      held.delete(leaseKey);
      decrement(h.key);
    }
  }
}

/** Take (or renew) a lease. `force` is for rehydration only — it never refuses. */
export function holdSlot(kind, projectId, leaseKey, expiresAt, { force = false } = {}) {
  pruneHeld();
  const limit = limitFor(kind);
  const existing = held.get(leaseKey);
  if (existing) {
    existing.expiresAt = expiresAt;
    return { ok: true, limit };
  }
  const key = `${kind}:${String(projectId)}`;
  const cur = slots.get(key) || 0;
  if (!force && cur >= limit) return { ok: false, limit };
  slots.set(key, cur + 1);
  held.set(leaseKey, { key, expiresAt });
  return { ok: true, limit };
}

export function renewHeldSlot(leaseKey, expiresAt) {
  const h = held.get(leaseKey);
  if (h) h.expiresAt = expiresAt;
}

/** Idempotent. */
export function releaseHeldSlot(leaseKey) {
  const h = held.get(leaseKey);
  if (!h) return;
  held.delete(leaseKey);
  decrement(h.key);
}

export function heldSlotsRehydrated() {
  return heldRehydrated;
}
export function markHeldSlotsRehydrated(v = true) {
  heldRehydrated = v;
}
