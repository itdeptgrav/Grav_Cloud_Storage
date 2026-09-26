// lib/config.js
// Central configuration for Grav Storage, read from the environment.
// Next.js auto-loads .env / .env.local. Nothing here is exposed to the browser
// unless it is prefixed NEXT_PUBLIC_ — and API secrets are deliberately never
// prefixed that way.

function bool(v, dflt) {
  if (v == null || v === "") return dflt;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

export const config = {
  port: Number(process.env.PORT || 4000),

  // A SEPARATE local database. Never the CMS/Atlas connection.
  mongoUri: process.env.MONGODB_URI || "mongodb://localhost:27017/grav_storage",

  // Where actual file bytes live — OUTSIDE this repo. Object files go under
  // this directory; tmp/ and trash/ are created as siblings (see localProvider).
  storageRoot: process.env.STORAGE_ROOT || "D:\\GravStorage\\data",
  storageProvider: (process.env.STORAGE_PROVIDER || "local").toLowerCase(),

  // Cloudinary-style public signup toggle.
  allowSignup: bool(process.env.ALLOW_SIGNUP, true),

  logRetentionDays: Number(process.env.LOG_RETENTION_DAYS || 30),

  // Max upload size. Default 2 GiB so ~900 MB works with headroom. Configurable.
  maxUploadBytes: Number(process.env.MAX_UPLOAD_SIZE_BYTES || 2 * 1024 * 1024 * 1024),
  // Hard cap on list page size — never let a client pull unbounded rows.
  maxListLimit: Number(process.env.MAX_LIST_LIMIT || 100),
  // Server-Timing / debug perf headers: on outside production, or when forced.
  perfHeaders:
    process.env.NODE_ENV !== "production" || process.env.STORAGE_PERF_HEADERS === "1",

  // ── Phase 4: production controls ──
  trashRetentionDays: Number(process.env.TRASH_RETENTION_DAYS || 30),
  tmpMaxAgeHours: Number(process.env.TMP_MAX_AGE_HOURS || 24),
  minFreeDiskBytes: Number(process.env.MIN_FREE_DISK_BYTES || 0), // 0 = disabled
  apiRateLimit: {
    requests: Number(process.env.API_RATE_LIMIT_REQUESTS || 2000),
    windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60000),
  },
  authRateLimit: {
    requests: Number(process.env.AUTH_RATE_LIMIT_REQUESTS || 300),
    windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60000),
  },
  maxConcurrentUploadsPerProject: Number(process.env.MAX_CONCURRENT_UPLOADS_PER_PROJECT || 10),
  maxConcurrentDownloadsPerProject: Number(process.env.MAX_CONCURRENT_DOWNLOADS_PER_PROJECT || 20),

  // ── Chunked uploads ──
  // Chunk payload size. Every chunk is one HTTP request, so it must stay safely
  // below the public proxy's request-body cap (Cloudflare Free/Pro ≈ 100 MB).
  // Default 80 MiB (≈ 83.9 MB); hard-clamped to [1 MiB, 90 MiB ≈ 94.4 MB] so a
  // mis-set env can never produce a chunk the proxy would reject. Clients may ask
  // for SMALLER chunks, never larger.
  chunkSizeBytes: Math.min(90 * 1048576, Math.max(1048576, Number(process.env.CHUNK_SIZE_BYTES || 80 * 1048576))),
  chunkMinBytes: 1048576,
  // Chunk size the DASHBOARD (browser) uploads with. Smaller than the API default
  // on purpose: measured through Cloudflare Tunnel, every chunk request is one
  // exposure to a mid-transfer drop, and a drop re-sends the whole chunk — so a
  // browser on an unreliable path wants short requests. Clamped to
  // [1 MiB, CHUNK_SIZE_BYTES]. API clients keep CHUNK_SIZE_BYTES unless they ask.
  browserChunkSizeBytes: 0, // set below (depends on chunkSizeBytes)
  // Automatic attempts per chunk in the browser before it pauses and waits for
  // the user (Retry). Sent to the client with the session. Clamped to [1, 20].
  uploadRetryMaxAttempts: Math.min(20, Math.max(1, Number(process.env.UPLOAD_RETRY_MAX_ATTEMPTS || 6))),
  // Read buffer for complete's from-disk verification. Measured: 1 MiB is fastest
  // with bounded RSS (see docs/chunked-upload-api.md). Clamped to [64 KiB, 8 MiB].
  chunkVerifyReadBytes: Math.min(8 * 1048576, Math.max(65536, Number(process.env.CHUNK_VERIFY_READ_BYTES || 1048576))),
  // A session expires this long after its LAST accepted chunk (sliding). Until
  // then it is resumable and holds its upload slot.
  chunkSessionIdleTtlMinutes: Number(process.env.CHUNK_SESSION_IDLE_TTL_MINUTES || 360),
  // The maintenance reaper only deletes an UNREFERENCED chunk temp file older than this.
  chunkOrphanMinAgeMinutes: Number(process.env.CHUNK_ORPHAN_MIN_AGE_MINUTES || 60),
  // A "completing" session older than this is treated as an interrupted finalize.
  chunkCompletingStaleMinutes: Number(process.env.CHUNK_COMPLETING_STALE_MINUTES || 15),
  // How long finished/aborted/expired session records are kept (MongoDB TTL).
  chunkSessionRetentionDays: Number(process.env.CHUNK_SESSION_RETENTION_DAYS || 7),

  // Used from Phase 1 onward (sessions + key hashing). Warned about, not
  // enforced, in Phase 0 because no auth exists yet.
  jwtSecret: process.env.JWT_SECRET || "",
  keyHashPepper: process.env.KEY_HASH_PEPPER || "",

  isProd: process.env.NODE_ENV === "production",
};

config.browserChunkSizeBytes = Math.min(config.chunkSizeBytes, Math.max(config.chunkMinBytes, Number(process.env.UPLOAD_BROWSER_CHUNK_BYTES || 16 * 1048576)));

/** Non-fatal startup validation. Logs once; never throws in Phase 0. */
export function validateConfig() {
  const warnings = [];
  if (config.isProd && !config.jwtSecret) {
    warnings.push("JWT_SECRET is not set — required before Phase 1 auth ships.");
  }
  return warnings;
}

export default config;
