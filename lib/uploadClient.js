// lib/uploadClient.js
// Browser upload to the SESSION dashboard plane, same-origin: the httpOnly
// session cookie authenticates and NO API key ever touches browser JS.
//
//   uploadFileXHR(projectId, file, callbacks) → controller
//     callbacks: onProgress(loaded, total) · onState(state, info) · onDone(result)
//     controller: { promise, chunked, pause(), resume(), cancel() }
//
// Small files (≤ CHUNK_THRESHOLD) → one streamed XHR POST, exactly as before.
// Large files → CHUNKED upload (lib/chunkedUploads.js on the server):
//   • each chunk is one request well under the proxy body cap (Cloudflare ~100 MB)
//   • each chunk carries its SHA-256 (native SubtleCrypto; the verified JS hasher
//     in lib/sha256.js is the fallback on non-HTTPS origins such as a LAN IP)
//   • a failed chunk is retried on its own — accepted chunks are never re-sent
//   • pause/resume continue from the server's accepted offset
//   • a page refresh can resume: only non-secret state (uploadId + this file's
//     own chunk hashes) is kept in localStorage; re-select the same file and the
//     already-uploaded part is re-hashed locally and checked against the server
//     before anything is sent, so a different file can never be spliced in
//   • complete sends a manifest checksum; the server re-verifies every chunk
//     from disk and commits only on an exact match.
// Memory: at most two chunks are held at once (current + prefetched next).

import { Sha256 } from "@/lib/sha256";

// Files above this go chunked. Kept equal to the default browser chunk size: a
// single request of more than one chunk has the same drop exposure as a big
// chunk, but no retry-just-this-part and no resume.
export const CHUNK_THRESHOLD = 16 * 1024 * 1024;
// Per-chunk automatic attempts before pausing for the user. The server sends the
// configured value with the session (retryPolicy.maxAttempts); this is the fallback.
const DEFAULT_MAX_ATTEMPTS = 6;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 20000;
/** Wait before the next attempt: exponential, capped, "equal jitter" (half fixed, half random). */
export function backoffDelay(failedAttempts) {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failedAttempts - 1));
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}
const STORE_PREFIX = "gs.chunked.v1:";

// Why a chunk attempt failed, in words a user can act on.
const CLOUDFLARE = { 502: "bad gateway", 503: "service unavailable", 504: "gateway timeout", 520: "origin error", 521: "origin down", 522: "origin connection timed out", 523: "origin unreachable", 524: "origin timed out", 530: "tunnel error" };
const mb = (n) => `${((n || 0) / 1e6).toFixed(1)} MB`;
export function describeFailure(e, att) {
  if (!att) return e?.message || "unknown error";
  if (att.kind === "network") return `network connection lost after ${mb(att.sentBytes)} of ${mb(att.bytes)}`;
  if (att.kind === "timeout") return "the request timed out";
  if (att.kind === "abort") return "the transfer was aborted";
  if (e.code === "CHUNK_INTERRUPTED" || e.code === "CHUNK_SIZE_MISMATCH") {
    const got = e.details?.receivedBytes;
    return `the chunk did not fully reach the server${got != null ? ` (${mb(got)} of ${mb(att.bytes)} arrived)` : ""}`;
  }
  if (e.code === "STORAGE_UNAVAILABLE") return "server storage error";
  if (e.code === "INSUFFICIENT_STORAGE") return "the server disk is full";
  if (e.code === "RATE_LIMIT_EXCEEDED" || att.status === 429) return "rate limited by the server";
  if (e.code) return `server error ${e.code}`;
  if (CLOUDFLARE[att.status]) return `Cloudflare ${att.status} (${CLOUDFLARE[att.status]})`;
  return `HTTP ${att.status}`;
}

// ───────────────────────── persistence (non-secret state only) ─────────────────────────
function storeKey(projectId) {
  return STORE_PREFIX + projectId;
}
function readStore(projectId) {
  try {
    return JSON.parse(localStorage.getItem(storeKey(projectId)) || "{}") || {};
  } catch {
    return {};
  }
}
function writeStore(projectId, data) {
  try {
    localStorage.setItem(storeKey(projectId), JSON.stringify(data));
  } catch {
    /* storage full / blocked — resume-after-refresh just won't be offered */
  }
}
export function fingerprintOf(file) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}
function saveEntry(projectId, fp, entry) {
  const all = readStore(projectId);
  all[fp] = { ...entry, savedAt: Date.now() };
  writeStore(projectId, all);
}
export function forgetPendingUpload(projectId, fp) {
  const all = readStore(projectId);
  delete all[fp];
  writeStore(projectId, all);
}
/** Uploads this browser started for the project that may still be resumable. */
export function listPendingUploads(projectId) {
  return Object.entries(readStore(projectId)).map(([fingerprint, e]) => ({ fingerprint, ...e }));
}

// ───────────────────────── small helpers ─────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function hex(buf) {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
async function sha256OfBuffer(buf) {
  if (typeof crypto !== "undefined" && crypto.subtle && typeof isSecureContext !== "undefined" && isSecureContext) {
    return hex(await crypto.subtle.digest("SHA-256", buf));
  }
  // Non-secure origin (e.g. http://192.168.x.x): verified JS SHA-256, fed in
  // 4 MiB slices with a yield between them so the page stays responsive.
  const h = new Sha256();
  const u8 = new Uint8Array(buf);
  for (let o = 0; o < u8.length; o += 4 << 20) {
    h.update(u8.subarray(o, Math.min(o + (4 << 20), u8.length)));
    await sleep(0);
  }
  return h.hex();
}
export function manifestOf(hashes) {
  return new Sha256().update(new TextEncoder().encode(hashes.join(""))).hex();
}

class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (HTTP ${status})`);
    this.status = status;
    this.code = body?.error?.code || null;
    this.details = body?.error?.details || null;
  }
}

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { credentials: "same-origin" });
  } catch {
    throw new ApiError(0, { error: { code: "NETWORK", message: "Network error." } });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) throw new ApiError(res.status, body);
  return body.data;
}
async function postJson(url, payload) {
  let res;
  try {
    res = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) });
  } catch {
    throw new ApiError(0, { error: { code: "NETWORK", message: "Network error." } });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) throw new ApiError(res.status, body);
  return body.data;
}

// ───────────────────────── single-shot (small files) ─────────────────────────
function uploadSingle(projectId, file, { onProgress, onDone, onState } = {}) {
  let xhr;
  let cancelled = false;
  const promise = new Promise((resolve) => {
    xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/dashboard/projects/${projectId}/files`, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name || "upload.bin"));
    if (file.type) xhr.setRequestHeader("x-file-type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* non-JSON */
      }
      const ok = xhr.status >= 200 && xhr.status < 300 && body.success;
      const result = ok
        ? { ok: true, file: body.data.file, fileId: body.data.fileId }
        : { ok: false, status: xhr.status, error: body?.error?.message || `Upload failed (HTTP ${xhr.status})`, code: body?.error?.code };
      onDone && onDone(result);
      resolve(result);
    };
    const failNet = () => {
      const r = cancelled
        ? { ok: false, status: 0, cancelled: true, error: "Upload cancelled." }
        : { ok: false, status: 0, interrupted: true, error: "Upload interrupted (network)." };
      onDone && onDone(r);
      resolve(r);
    };
    xhr.onerror = failNet;
    xhr.onabort = failNet;
    onState && onState("uploading", {});
    xhr.send(file);
  });
  return {
    chunked: false,
    promise,
    pause() {},
    resume() {},
    cancel() {
      cancelled = true;
      try {
        xhr.abort();
      } catch {
        /* ignore */
      }
    },
  };
}

// ───────────────────────── chunked (large files) ─────────────────────────
class ChunkedUpload {
  constructor(projectId, file, callbacks, { resumeAfterReload = false } = {}) {
    this.projectId = projectId;
    this.file = file;
    this.cb = callbacks || {};
    this.fp = fingerprintOf(file);
    this.base = `/api/dashboard/projects/${projectId}/files/chunk`;
    this.resumeAfterReload = resumeAfterReload;
    this.session = null; // server view: { uploadId, chunkSize, totalChunks, nextIndex, bytesReceived, chunkHashes }
    this.hashes = []; // OUR hashes of this file's chunks
    this.paused = false;
    this.pauseReason = "paused"; // or "interrupted" when automatic retries ran out
    this.cancelled = false;
    this.xhr = null;
    this.wake = null; // resolves when resumed
    this.pauseInfo = {}; // why we are paused (shown with the Retry button)
    this.acceptedBytes = 0;
    this.maxAttempts = DEFAULT_MAX_ATTEMPTS;
    // Metrics: committed = bytes the server accepted; everything sent in failed
    // attempts is counted separately and never shown as progress.
    this.m = { inFlight: 0, retransmitted: 0, retries: 0, currentBps: 0, sample: null, committedAtStart: null, activeMs: 0, activeSince: null };
    this.failures = []; // per failed attempt: safe diagnostics only (no cookies, keys or paths)
    this.promise = this.run();
  }

  state(s, info = {}) {
    this.cb.onState && this.cb.onState(s, { totalChunks: this.session?.totalChunks || 0, ...info });
  }
  progress(inFlight = 0) {
    this.m.inFlight = inFlight;
    this.cb.onProgress && this.cb.onProgress(Math.min(this.file.size, this.acceptedBytes + inFlight), this.file.size);
    this.emitStats();
  }
  // Active time excludes pauses and waiting for the user.
  clock(running) {
    const now = performance.now();
    if (this.m.activeSince != null) this.m.activeMs += now - this.m.activeSince;
    this.m.activeSince = running ? now : null;
  }
  emitStats() {
    if (!this.cb.onStats) return;
    const m = this.m;
    const activeSec = (m.activeMs + (m.activeSince != null ? performance.now() - m.activeSince : 0)) / 1000;
    const gained = m.committedAtStart == null ? 0 : this.acceptedBytes - m.committedAtStart;
    const effectiveBps = activeSec > 2 && gained > 0 ? gained / activeSec : 0; // successful bytes only
    const remaining = this.file.size - this.acceptedBytes;
    const rate = effectiveBps || m.currentBps;
    this.cb.onStats({
      committed: this.acceptedBytes,
      inFlight: m.inFlight,
      total: this.file.size,
      currentBps: m.currentBps,
      effectiveBps,
      retransmitted: m.retransmitted,
      retries: m.retries,
      etaSec: rate > 0 ? Math.max(0, remaining - (effectiveBps ? 0 : m.inFlight)) / rate : null,
    });
  }
  // Upload progress of the attempt on the wire → current speed (smoothed).
  onWire(loaded) {
    const now = performance.now();
    const s = this.m.sample;
    if (!s || loaded < s.loaded) this.m.sample = { t: now, loaded };
    else if (now - s.t >= 500) {
      const bps = ((loaded - s.loaded) / (now - s.t)) * 1000;
      this.m.currentBps = this.m.currentBps ? this.m.currentBps * 0.6 + bps * 0.4 : bps;
      this.m.sample = { t: now, loaded };
    }
    this.progress(loaded);
  }
  noteFailure(att, e, reason, attempt) {
    if (!att) return;
    this.m.retries++;
    this.m.retransmitted += att.sentBytes || 0;
    const rec = {
      uploadId: this.session?.uploadId,
      index: att.index,
      attempt,
      bytes: att.bytes,
      sentBytes: att.sentBytes || 0,
      startedAt: att.startedAt,
      failedAt: att.failedAt,
      elapsedMs: att.elapsedMs,
      kind: att.kind, // "network" | "timeout" | "abort" | "http"
      status: att.status || 0,
      code: e?.code || null,
      receivedByServer: e?.details?.receivedBytes ?? null,
      reachedServer: att.reachedServer, // "yes" (our JSON) | "no" (proxy page) | "unknown" (no response)
      cfRay: att.cfRay || null,
      requestId: att.requestId || null,
      reason,
    };
    this.failures.push(rec);
    if (this.failures.length > 100) this.failures.shift();
    try {
      const all = (window.__gsUploadDiagnostics = window.__gsUploadDiagnostics || {});
      all[rec.uploadId] = this.failures;
      console.info(`[upload] chunk ${rec.index + 1}/${this.session?.totalChunks} attempt ${attempt}/${this.maxAttempts} failed after ${(rec.elapsedMs / 1000).toFixed(1)} s: ${reason} (HTTP ${rec.status || "-"}${rec.code ? ` ${rec.code}` : ""}${rec.cfRay ? `, cf-ray ${rec.cfRay}` : ""}${rec.requestId ? `, request ${rec.requestId}` : ""}; reached server: ${rec.reachedServer})`);
    } catch {
      /* no window (tests) */
    }
    this.emitStats();
  }
  persist() {
    if (!this.session) return;
    saveEntry(this.projectId, this.fp, {
      uploadId: this.session.uploadId,
      name: this.file.name,
      size: this.file.size,
      lastModified: this.file.lastModified,
      type: this.file.type || "",
      chunkSize: this.session.chunkSize,
      totalChunks: this.session.totalChunks,
      hashes: this.hashes.slice(0, this.session.nextIndex),
    });
  }
  chunkRange(i) {
    const start = i * this.session.chunkSize;
    return [start, Math.min(start + this.session.chunkSize, this.file.size)];
  }
  async readChunk(i) {
    const [s, e] = this.chunkRange(i);
    const buf = await this.file.slice(s, e).arrayBuffer();
    return { buf, hash: await sha256OfBuffer(buf) };
  }

  pause() {
    if (this.cancelled || this.paused) return;
    this.paused = true;
    this.pauseReason = "paused";
    try {
      this.xhr && this.xhr.abort(); // the server cuts the partial chunk back
    } catch {
      /* ignore */
    }
  }
  resume() {
    if (!this.paused || this.cancelled) return;
    this.paused = false;
    this.pauseReason = "paused";
    const w = this.wake;
    this.wake = null;
    w && w();
  }
  async cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    try {
      this.xhr && this.xhr.abort();
    } catch {
      /* ignore */
    }
    const w = this.wake;
    this.wake = null;
    w && w();
    if (this.session) await postJson(`${this.base}?op=abort&uploadId=${this.session.uploadId}`).catch(() => {});
    forgetPendingUpload(this.projectId, this.fp);
  }
  async waitWhilePaused(info) {
    if (!this.paused || this.cancelled) return;
    this.clock(false);
    while (this.paused && !this.cancelled) {
      this.state(this.pauseReason, { ...info, ...(this.pauseReason === "interrupted" ? this.pauseInfo : {}) });
      this.emitStats();
      await new Promise((r) => (this.wake = r));
    }
    this.clock(true);
  }

  // Load an existing session (after pause/refresh) or begin a new one.
  async openSession() {
    const saved = readStore(this.projectId)[this.fp];
    if (saved?.uploadId) {
      let s = null;
      try {
        s = await getJson(`${this.base}?op=status&uploadId=${saved.uploadId}`);
      } catch (e) {
        // Only a DEFINITIVE answer discards the saved session; a network blip or a
        // disabled project must never throw away a resumable upload.
        if (!["UPLOAD_SESSION_NOT_FOUND", "UPLOAD_SESSION_FORBIDDEN", "UPLOAD_SESSION_EXPIRED"].includes(e.code)) throw e;
      }
      if (s && s.status === "active" && s.declaredSize === this.file.size) {
        this.session = s;
        this.hashes = Array.isArray(saved.hashes) ? saved.hashes.slice() : [];
        // A new File object (reload or re-drop) is re-hashed before anything is
        // sent, so a different file with the same name/size can't be spliced in.
        this.resumeAfterReload = true;
        return;
      }
      forgetPendingUpload(this.projectId, this.fp);
    }
    // No chunkSize sent: the server picks the browser chunk size it is configured with.
    this.session = await postJson(`${this.base}?op=begin`, {
      filename: this.file.name || "upload.bin",
      size: this.file.size,
      mimeType: this.file.type || "application/octet-stream",
    });
    this.hashes = [];
    this.persist();
  }
  applyPolicy() {
    const n = Number(this.session?.retryPolicy?.maxAttempts);
    if (Number.isInteger(n) && n >= 1 && n <= 20) this.maxAttempts = n;
  }
  /** After a failed attempt: did the server take the chunk anyway (response lost)? */
  async serverHas(index) {
    try {
      const s = await getJson(`${this.base}?op=status&uploadId=${this.session.uploadId}`);
      return s.status === "active" && s.nextIndex > index ? s : null;
    } catch {
      return null;
    }
  }

  // Make sure OUR hash of every chunk the server holds matches the server's.
  // After a reload the chosen file is re-hashed locally, so a different file with
  // the same name/size can never be spliced onto someone else's bytes.
  async verifyPrefix() {
    const n = this.session.nextIndex;
    for (let i = 0; i < n; i++) {
      if (this.resumeAfterReload || !this.hashes[i]) {
        this.state("verifying", { index: i, verified: i });
        const [s, e] = this.chunkRange(i);
        this.hashes[i] = await sha256OfBuffer(await this.file.slice(s, e).arrayBuffer());
      }
      if (this.hashes[i] !== this.session.chunkHashes[i]) {
        throw new ApiError(409, { error: { code: "FILE_MISMATCH", message: "The selected file does not match the upload in progress." } });
      }
    }
    this.resumeAfterReload = false;
    this.acceptedBytes = this.session.bytesReceived;
    this.progress();
  }

  async refreshStatus() {
    this.session = await getJson(`${this.base}?op=status&uploadId=${this.session.uploadId}`);
    if (this.session.status !== "active") throw new ApiError(409, { error: { code: "UPLOAD_SESSION_CLOSED", message: `The upload session is ${this.session.status}.` } });
  }

  putChunk(index, buf, hash) {
    const att = { index, bytes: buf.byteLength, sentBytes: 0, startedAt: new Date().toISOString(), t0: performance.now() };
    this.m.sample = null;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.xhr = xhr;
      xhr.open("POST", `${this.base}?op=append&uploadId=${this.session.uploadId}&index=${index}`, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.setRequestHeader("x-chunk-sha256", hash);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        att.sentBytes = e.loaded;
        this.onWire(e.loaded);
      };
      const finish = (kind) => {
        this.xhr = null;
        att.kind = kind;
        att.status = xhr.status;
        att.elapsedMs = Math.round(performance.now() - att.t0);
        att.failedAt = new Date().toISOString();
        let body = null;
        if (kind === "http") {
          try {
            body = JSON.parse(xhr.responseText || "null");
          } catch {
            /* non-JSON: a proxy/Cloudflare page */
          }
          att.cfRay = xhr.getResponseHeader("cf-ray");
          att.requestId = xhr.getResponseHeader("x-request-id");
          // Grav Storage always answers JSON { success }; anything else came from the proxy.
          att.reachedServer = body && typeof body === "object" && "success" in body ? "yes" : "no";
          if (xhr.status >= 200 && xhr.status < 300 && body?.success) {
            // Current speed also from each finished chunk: some browsers (hidden
            // tabs) deliver a single progress event per request.
            const bps = att.elapsedMs > 0 ? (att.bytes / att.elapsedMs) * 1000 : 0;
            if (bps > 0) this.m.currentBps = this.m.currentBps ? this.m.currentBps * 0.5 + bps * 0.5 : bps;
            return resolve(body.data);
          }
        } else att.reachedServer = "unknown";
        const code = kind === "http" ? undefined : this.paused ? "PAUSED" : this.cancelled ? "CANCELLED" : kind === "timeout" ? "TIMEOUT" : "NETWORK";
        const err = new ApiError(xhr.status, body || { error: { code, message: "Chunk transfer interrupted." } });
        err.attempt = att;
        reject(err);
      };
      xhr.onload = () => finish("http");
      xhr.onerror = () => finish("network");
      xhr.onabort = () => finish("abort");
      xhr.ontimeout = () => finish("timeout");
      xhr.send(buf);
    });
  }

  // Send chunk `index`, retrying ONLY this chunk. Accepted chunks are never
  // re-sent; after the automatic attempts run out the upload pauses (session
  // kept) until the user presses Retry. Returns the server progress.
  async sendChunk(index, prepared) {
    let { buf, hash } = prepared;
    let checksumRetries = 0;
    let reason = null;
    for (let attempt = 1; ; attempt++) {
      await this.waitWhilePaused({ index });
      if (this.cancelled) throw new ApiError(0, { error: { code: "CANCELLED", message: "Upload cancelled." } });
      this.state(attempt === 1 ? "uploading" : "retrying", { index, attempt, maxAttempts: this.maxAttempts, reason });
      try {
        return await this.putChunk(index, buf, hash);
      } catch (e) {
        if (e.code === "PAUSED") {
          attempt = 0; // a pause is not a failure
          continue;
        }
        if (e.code === "CANCELLED") throw e;
        if (e.code === "BAD_CHUNK_INDEX" || e.code === "CHUNK_CONFLICT") throw e; // the caller resyncs
        reason = describeFailure(e, e.attempt);
        this.noteFailure(e.attempt, e, reason, attempt);
        this.progress(0); // the failed attempt's bytes are not progress: back to what the server accepted
        if (e.code === "CHUNK_CHECKSUM_MISMATCH" && checksumRetries < 3) {
          checksumRetries++;
          ({ buf, hash } = await this.readChunk(index)); // re-read from disk and resend
          this.hashes[index] = hash;
          attempt = 0;
          continue;
        }
        const retryable = e.status === 0 || e.status >= 500 || ["CHUNK_INTERRUPTED", "CHUNK_SIZE_MISMATCH", "CHUNK_IN_PROGRESS", "STORAGE_UNAVAILABLE", "INSUFFICIENT_STORAGE", "RATE_LIMIT_EXCEEDED"].includes(e.code) || e.status === 429;
        if (!retryable) throw e;
        // The server may have accepted the chunk and only the response was lost.
        const had = await this.serverHas(index);
        if (had) return had;
        if (attempt >= this.maxAttempts) {
          this.paused = true;
          this.pauseReason = "interrupted";
          this.pauseInfo = { index, reason, attempts: attempt, maxAttempts: this.maxAttempts };
          attempt = 0; // Retry gives this chunk a fresh set of attempts
          continue;
        }
        const wait = backoffDelay(attempt);
        this.state("retrying", { index, attempt: attempt + 1, maxAttempts: this.maxAttempts, reason, nextRetryInMs: wait });
        await sleep(wait);
      }
    }
  }

  async run() {
    const done = (r) => {
      this.cb.onDone && this.cb.onDone(r);
      return r;
    };
    try {
      this.state("preparing");
      await this.openSession();
      this.applyPolicy();
      await this.verifyPrefix();
      // Effective speed counts only bytes accepted from here on, over active time.
      this.m.committedAtStart = this.acceptedBytes;
      this.clock(true);

      let prefetch = null;
      let i = this.session.nextIndex;
      while (i < this.session.totalChunks) {
        if (this.cancelled) throw new ApiError(0, { error: { code: "CANCELLED", message: "Upload cancelled." } });
        const prepared = prefetch && prefetch.index === i ? await prefetch.p : await this.readChunk(i);
        this.hashes[i] = prepared.hash;
        // Read + hash the NEXT chunk while this one is on the wire.
        if (i + 1 < this.session.totalChunks) {
          const next = this.readChunk(i + 1);
          next.catch(() => {}); // surfaced when awaited; never an unhandled rejection
          prefetch = { index: i + 1, p: next };
        } else prefetch = null;
        try {
          const r = await this.sendChunk(i, prepared);
          this.session.nextIndex = r.nextIndex;
          this.session.bytesReceived = r.bytesReceived;
          this.acceptedBytes = r.bytesReceived;
          this.progress(0);
          this.persist();
          i = r.nextIndex;
        } catch (e) {
          if (e.code === "BAD_CHUNK_INDEX" || e.code === "CHUNK_CONFLICT") {
            // Our view drifted from the server's: resync and re-verify.
            await this.refreshStatus();
            await this.verifyPrefix();
            prefetch = null;
            i = this.session.nextIndex;
            continue;
          }
          throw e;
        }
      }

      // Last consistency check: our hash list must equal what the server accepted.
      this.clock(false);
      await this.refreshStatus();
      await this.verifyPrefix();
      this.state("finalizing");
      const manifestSha256 = manifestOf(this.hashes.slice(0, this.session.totalChunks));
      let result;
      for (let attempt = 1; ; attempt++) {
        try {
          result = await postJson(`${this.base}?op=complete&uploadId=${this.session.uploadId}`, { manifestSha256 });
          break;
        } catch (e) {
          if ((e.status === 0 || e.status >= 500 || e.code === "UPLOAD_FINALIZING") && attempt < 6) {
            await sleep(backoffDelay(attempt));
            continue;
          }
          throw e;
        }
      }
      forgetPendingUpload(this.projectId, this.fp);
      this.acceptedBytes = this.file.size;
      this.progress();
      return done({ ok: true, file: result.file, fileId: result.fileId, chunked: true });
    } catch (e) {
      this.clock(false);
      if (e.code === "CANCELLED") return done({ ok: false, cancelled: true, error: "Upload cancelled." });
      const terminal = ["UPLOAD_SESSION_NOT_FOUND", "UPLOAD_SESSION_EXPIRED", "UPLOAD_SESSION_CLOSED", "UPLOAD_SESSION_FORBIDDEN", "CHECKSUM_MISMATCH", "UPLOAD_DATA_MISSING"];
      if (terminal.includes(e.code)) forgetPendingUpload(this.projectId, this.fp);
      return done({ ok: false, status: e.status, code: e.code, error: e.message, resumable: !terminal.includes(e.code) && e.code !== "FILE_MISMATCH" });
    }
  }
}

function controllerFor(u) {
  return { chunked: true, promise: u.promise, pause: () => u.pause(), resume: () => u.resume(), cancel: () => u.cancel() };
}

export function uploadFileXHR(projectId, file, callbacks = {}) {
  if (file.size > CHUNK_THRESHOLD) return controllerFor(new ChunkedUpload(projectId, file, callbacks));
  return uploadSingle(projectId, file, callbacks);
}

/** Continue a chunked upload after a page reload, with the file the user re-selected. */
export function resumeChunkedUpload(projectId, file, callbacks = {}) {
  return controllerFor(new ChunkedUpload(projectId, file, callbacks, { resumeAfterReload: true }));
}

/** Abandon a stored resumable upload (server temp data is deleted). */
export async function discardPendingUpload(projectId, entry) {
  if (entry?.uploadId) await postJson(`/api/dashboard/projects/${projectId}/files/chunk?op=abort&uploadId=${entry.uploadId}`).catch(() => {});
  forgetPendingUpload(projectId, entry.fingerprint);
}

/** Server-side status for a stored entry (null when gone). */
export async function pendingUploadStatus(projectId, entry) {
  try {
    return await getJson(`/api/dashboard/projects/${projectId}/files/chunk?op=status&uploadId=${entry.uploadId}`);
  } catch {
    return null;
  }
}
