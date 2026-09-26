// lib/chunkedUploads.js
// CHUNKED uploads for files larger than a proxy's per-request body cap (e.g.
// Cloudflare's ~100 MB). Every chunk is its own HTTP request, and progress is
// PERSISTED (UploadSession in MongoDB), so an upload can continue after a failed
// chunk, a dropped connection, a page refresh or a server restart — from the
// last ACCEPTED chunk, never from zero.
//
// Integrity, end to end:
//   append   — the client sends the SHA-256 of each chunk (x-chunk-sha256). The
//              server hashes the bytes as they stream to disk and accepts the
//              chunk only if they match; otherwise the temp file is cut back to
//              where the chunk began and the session is unchanged (retry it).
//   complete — the client sends a manifest checksum over its chunk hashes (and,
//              optionally, the full-file SHA-256). The server RE-READS the whole
//              temp file from disk, recomputes every chunk hash and the true
//              full-file SHA-256, and commits only if all of them match.
//
// Retry safety: before writing chunk N the temp file is truncated to exactly the
// bytes of chunks 0..N-1, so leftovers of a failed/interrupted attempt (or of a
// crash) can never leak into the file. A chunk the server already accepted is
// acknowledged again without being written twice (same hash) or rejected (a
// different hash).
//
// Lifetime: a session holds one upload slot (lib/limits, same pool as
// single-shot uploads) from begin until complete / abort / expiry. It expires
// CHUNK_SESSION_IDLE_TTL_MINUTES after its last accepted chunk; expired sessions
// and orphaned temp files are removed by lib/maintenance.cleanChunkSessions().
//
// Assumes ONE Node process (as lib/limits already does): the in-flight chunk
// lock and the slot leases are process memory; both are rebuilt safely after a
// restart (the lock starts empty; leases are rehydrated from MongoDB).

import crypto from "crypto";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { ok, fail } from "@/lib/http";
import config from "@/lib/config";
import { connectDB } from "@/lib/db/mongoose";
import UploadSession from "@/lib/db/models/UploadSession";
import FileObject from "@/lib/db/models/FileObject";
import getStorageProvider from "@/lib/storage/provider";
import { finalize } from "@/lib/fileIngest";
import { checkDiskFree } from "@/lib/services/quotaService";
import { holdSlot, renewHeldSlot, releaseHeldSlot, heldSlotsRehydrated, markHeldSlotsRehydrated } from "@/lib/limits";
import { recordError } from "@/lib/services/usageService";
import { randBase62 } from "@/lib/ids";
import { logError } from "@/lib/logSafe";
import { setLogCtx } from "@/lib/apiLog";

const SHA_RE = /^[a-f0-9]{64}$/;
// Opt-in per-stage timing (same switch as finalize's): UPLOAD_TIMING=1. Off = no-op.
const TIMING = /^(1|true|yes|on)$/i.test(process.env.UPLOAD_TIMING || "");
const UPLOAD_ID_RE = /^up_[A-Za-z0-9]{32}$/;

// Chunk-in-flight lock per uploadId. On globalThis so a dev hot-reload of this
// module cannot drop a lock while a write is still streaming.
const busy = globalThis.__gsChunkBusy || (globalThis.__gsChunkBusy = new Set());
// uploadId → the attempt currently streaming ({ index, abort, done }), so a retry
// of that same chunk can take over an orphaned attempt (see opAppend).
const inflight = globalThis.__gsChunkInflight || (globalThis.__gsChunkInflight = new Map());
const TAKEOVER_WAIT_MS = 10000; // max wait for an aborted attempt to clean up
let rehydrating = null;

const idleTtlMs = () => config.chunkSessionIdleTtlMinutes * 60000;
const newExpiry = () => new Date(Date.now() + idleTtlMs());
const retentionDate = () => new Date(Date.now() + config.chunkSessionRetentionDays * 86400000);
const chunkLength = (s, i) => (i < s.totalChunks - 1 ? s.chunkSize : s.declaredSize - s.chunkSize * (s.totalChunks - 1));

/** The manifest checksum: SHA-256 over the concatenated lowercase hex chunk hashes. */
export function manifestSha256(hashes) {
  return crypto.createHash("sha256").update(hashes.join("")).digest("hex");
}

function cancelBody(request) {
  try {
    request.body?.cancel?.().catch(() => {});
  } catch {
    /* already consumed */
  }
}

/** The browser client's retry budget travels with the session (server-configurable). */
function withPolicy(view) {
  return { ...view, retryPolicy: { maxAttempts: config.uploadRetryMaxAttempts } };
}

/** A chunk body that stopped arriving: how much came, after how long (no paths). */
function logIncomplete(ids, received, len, tA, why) {
  const ms = Math.round(performance.now() - tA);
  console.warn(`[chunk.append.incomplete] uploadId=${ids.uploadId} projectId=${ids.projectId} index=${ids.index} received=${received}/${len} bytes after ${ms}ms (${why || "stream ended"})`);
}

function progress(s, extra = {}) {
  return {
    uploadId: s.uploadId,
    nextIndex: s.nextIndex,
    totalChunks: s.totalChunks,
    bytesReceived: s.bytesReceived,
    declaredSize: s.declaredSize,
    expiresAt: s.expiresAt,
    ...extra,
  };
}

// After a restart the slot leases are gone from memory — rebuild them from the
// persisted sessions before any limit decision is made.
async function ensureRehydrated() {
  if (heldSlotsRehydrated()) return;
  if (!rehydrating) {
    rehydrating = (async () => {
      const live = await UploadSession.find({ status: { $in: ["active", "completing"] }, expiresAt: { $gt: new Date() } })
        .select("uploadId projectId expiresAt")
        .lean();
      for (const s of live) holdSlot("upload", s.projectId, s.uploadId, new Date(s.expiresAt).getTime(), { force: true });
      markHeldSlotsRehydrated(true);
    })().finally(() => {
      rehydrating = null;
    });
  }
  await rehydrating;
}

function ownerMatches(s, actor) {
  if (String(s.projectId) !== String(actor.project._id)) return false;
  if (s.plane !== actor.plane) return false;
  if (actor.plane === "dashboard") return !!actor.user && String(s.ownerUserId) === String(actor.user._id);
  return !!actor.apiKey && String(s.ownerApiKeyId) === String(actor.apiKey._id);
}

async function loadOwned(uploadId, actor) {
  if (!UPLOAD_ID_RE.test(String(uploadId || ""))) return { error: fail("UPLOAD_SESSION_NOT_FOUND", "Upload session not found.") };
  const s = await UploadSession.findOne({ uploadId });
  if (!s) return { error: fail("UPLOAD_SESSION_NOT_FOUND", "Upload session not found.") };
  if (!ownerMatches(s, actor)) {
    return { error: fail("UPLOAD_SESSION_FORBIDDEN", "This upload session belongs to another user, API key or project.") };
  }
  return { session: s };
}

/** Terminal cleanup shared by expire / fail / abort: temp gone, slot freed. */
async function closeSession(s, status, failureCode = null) {
  await getStorageProvider().removeChunkTemp(s.tmpObjId).catch(() => {});
  releaseHeldSlot(s.uploadId);
  await UploadSession.updateOne(
    { _id: s._id, status: { $in: ["active", "completing"] } },
    { $set: { status, failureCode, purgeAt: retentionDate() } },
  );
  s.status = status;
  s.failureCode = failureCode;
}

const isExpired = (s) => s.status === "active" && new Date(s.expiresAt).getTime() <= Date.now();

// A finalize that never finished (crash) is recovered as a failure.
async function recoverStaleCompleting(s) {
  if (s.status !== "completing" || !s.completingAt) return false;
  if (Date.now() - new Date(s.completingAt).getTime() < config.chunkCompletingStaleMinutes * 60000) return false;
  await closeSession(s, "failed", "UPLOAD_FINALIZE_INTERRUPTED");
  return true;
}

/** Gate for append/complete: returns an error Response, or null if the session can take work. */
async function gateActive(s) {
  if (isExpired(s)) {
    await closeSession(s, "expired");
    return fail("UPLOAD_SESSION_EXPIRED", "This upload session expired. Start the upload again.");
  }
  if (s.status === "completing") {
    if (await recoverStaleCompleting(s)) return fail("UPLOAD_SESSION_CLOSED", "The upload could not be finalized. Start it again.");
    return fail("UPLOAD_FINALIZING", "This upload is being finalized.");
  }
  if (s.status === "expired") return fail("UPLOAD_SESSION_EXPIRED", "This upload session expired. Start the upload again.");
  if (s.status !== "active") return fail("UPLOAD_SESSION_CLOSED", `This upload session is ${s.status}.`);
  return null;
}

const projectDisabled = () => fail("PROJECT_DISABLED", "The project for this upload is not active.");
const quotaWouldExceed = (project, bytes) => project.quotaBytes != null && (project.currentStorageBytes || 0) + bytes > project.quotaBytes;

// ───────────────────────────── begin ─────────────────────────────
async function opBegin(request, actor) {
  const { project } = actor;
  if (project.status !== "active") return projectDisabled();
  const body = await request.json().catch(() => ({}));

  const size = Number(body.size);
  if (!Number.isSafeInteger(size) || size < 1) return fail("VALIDATION_ERROR", "size must be a positive integer (bytes).");
  if (size > config.maxUploadBytes) return fail("FILE_TOO_LARGE", "File exceeds the maximum upload size.");
  const filename = String(body.filename || "").trim();
  if (!filename) return fail("VALIDATION_ERROR", "filename is required.");
  const expected = body.sha256 == null ? null : String(body.sha256).toLowerCase();
  if (expected && !SHA_RE.test(expected)) return fail("VALIDATION_ERROR", "sha256 must be 64 hex characters.");

  // Chunk size: the plane's default (the browser gets short requests — see
  // config.browserChunkSizeBytes), or a SMALLER one the client asks for.
  let chunkSize = actor.plane === "dashboard" ? config.browserChunkSizeBytes : config.chunkSizeBytes;
  if (body.chunkSize != null) {
    const want = Number(body.chunkSize);
    if (!Number.isSafeInteger(want) || want < config.chunkMinBytes || want > config.chunkSizeBytes) {
      return fail("VALIDATION_ERROR", `chunkSize must be between ${config.chunkMinBytes} and ${config.chunkSizeBytes} bytes.`);
    }
    chunkSize = want;
  }

  if (quotaWouldExceed(project, size)) return fail("STORAGE_QUOTA_EXCEEDED", "This upload would exceed the project storage quota.");
  const disk = await checkDiskFree(size);
  if (!disk.ok) return fail("INSUFFICIENT_STORAGE", "The storage disk is too low on free space to accept this upload.");

  const uploadId = `up_${randBase62(32)}`;
  const expiresAt = newExpiry();
  const slot = holdSlot("upload", project._id, uploadId, expiresAt.getTime());
  if (!slot.ok) return fail("TOO_MANY_CONCURRENT_TRANSFERS", `Too many concurrent uploads for this project (max ${slot.limit}).`);

  const provider = getStorageProvider();
  let temp;
  try {
    temp = await provider.createChunkTemp();
  } catch (e) {
    releaseHeldSlot(uploadId);
    logError("chunk.begin.temp", { uploadId, projectId: project._id }, e);
    return fail("STORAGE_UNAVAILABLE", "Could not start the upload.");
  }
  let s;
  try {
    s = await UploadSession.create({
      uploadId,
      projectId: project._id,
      plane: actor.plane,
      ownerUserId: actor.plane === "dashboard" ? actor.user._id : null,
      ownerApiKeyId: actor.plane === "api" ? actor.apiKey._id : null,
      originalName: filename.slice(0, 400),
      mimeType: String(body.mimeType || "application/octet-stream").slice(0, 200),
      declaredSize: size,
      chunkSize,
      totalChunks: Math.ceil(size / chunkSize),
      expectedSha256: expected,
      tmpObjId: temp.objId,
      expiresAt,
    });
  } catch (e) {
    await provider.removeChunkTemp(temp.objId).catch(() => {});
    releaseHeldSlot(uploadId);
    logError("chunk.begin.session", { uploadId, projectId: project._id }, e);
    return fail("STORAGE_UNAVAILABLE", "Could not start the upload.");
  }
  return ok(withPolicy(s.toPublic()), { status: 201 });
}

// ───────────────────────────── append ─────────────────────────────
function storageErrorResponse(e) {
  if (e?.code === "ENOSPC") return fail("INSUFFICIENT_STORAGE", "The storage disk ran out of space while writing this chunk.");
  return fail("STORAGE_UNAVAILABLE", "The chunk could not be written. Retry it.");
}

async function opAppend(request, actor, url) {
  const uploadId = url.searchParams.get("uploadId");
  const index = Number(url.searchParams.get("index"));
  const claimed = String(request.headers.get("x-chunk-sha256") || "").toLowerCase();
  if (!Number.isSafeInteger(index) || index < 0) {
    cancelBody(request);
    return fail("VALIDATION_ERROR", "index must be a non-negative integer.");
  }
  if (!SHA_RE.test(claimed)) {
    cancelBody(request);
    return fail("VALIDATION_ERROR", "Header x-chunk-sha256 (64 hex characters) is required on every chunk.");
  }

  let { session: s, error } = await loadOwned(uploadId, actor);
  if (error) {
    cancelBody(request);
    return error;
  }
  const gate = await gateActive(s);
  if (gate) {
    cancelBody(request);
    return gate;
  }
  if (actor.project.status !== "active") {
    cancelBody(request);
    return projectDisabled();
  }
  // A retry of the chunk an earlier attempt is STILL streaming: that attempt is
  // orphaned — the client already saw it fail (measured on cloud.grav.in: the
  // proxy answers 502 while the server-side request waits ~20 s more for bytes
  // that never come, and every retry in that window used to get 409 after
  // re-uploading the whole chunk). Abort it and take the chunk over. Sequential
  // semantics are unchanged: still one writer per upload, at nextIndex only.
  const running = inflight.get(uploadId);
  if (running && running.index === index) {
    running.abort.abort();
    await Promise.race([running.done, new Promise((r) => setTimeout(r, TAKEOVER_WAIT_MS))]);
    if (!busy.has(uploadId)) {
      s = await UploadSession.findOne({ uploadId }); // it may have finished just before the abort
      const g = s ? await gateActive(s) : fail("UPLOAD_SESSION_NOT_FOUND", "Upload session not found.");
      if (g) {
        cancelBody(request);
        return g;
      }
    }
  }
  if (index >= s.totalChunks) {
    cancelBody(request);
    return fail("BAD_CHUNK_INDEX", `This upload has ${s.totalChunks} chunks (0–${s.totalChunks - 1}).`, { details: { expected: s.nextIndex } });
  }

  // Already accepted → idempotent: same bytes = success, never written twice.
  if (index < s.nextIndex) {
    cancelBody(request);
    if (s.chunkHashes[index] === claimed) return ok(progress(s, { index, accepted: true, alreadyAccepted: true }));
    return fail("CHUNK_CONFLICT", `Chunk ${index} was already accepted with different content.`, { details: { expected: s.nextIndex } });
  }
  if (index > s.nextIndex) {
    cancelBody(request);
    return fail("BAD_CHUNK_INDEX", `Expected chunk ${s.nextIndex}, got ${index}. Resume from ${s.nextIndex}.`, { details: { expected: s.nextIndex } });
  }
  if (!request.body) return fail("CHUNK_SIZE_MISMATCH", "The chunk body is empty.");

  // index === nextIndex — the only chunk we write.
  if (busy.has(uploadId)) {
    cancelBody(request);
    return fail("CHUNK_IN_PROGRESS", `Chunk ${index} is still being written by an earlier attempt. Retry shortly.`);
  }
  busy.add(uploadId);
  // Registered so a retry of this chunk can abort it if this attempt is orphaned.
  const abort = new AbortController();
  let release;
  const mine = { index, abort, done: new Promise((r) => (release = r)) };
  inflight.set(uploadId, mine);
  const provider = getStorageProvider();
  const len = chunkLength(s, index);
  const offset = s.bytesReceived;
  const ids = { uploadId, projectId: s.projectId, index }; // for log lines (never paths)
  let wrote = false;
  try {
    if (quotaWouldExceed(actor.project, s.declaredSize)) {
      cancelBody(request);
      return fail("STORAGE_QUOTA_EXCEEDED", "This upload would exceed the project storage quota.");
    }
    const declaredLen = request.headers.get("content-length");
    if (declaredLen != null && Number(declaredLen) !== len) {
      cancelBody(request);
      return fail("CHUNK_SIZE_MISMATCH", `Chunk ${index} must be exactly ${len} bytes.`, { details: { expectedBytes: len } });
    }
    // Disk safety is re-checked on EVERY chunk (O(1) statfs), not just at begin.
    const disk = await checkDiskFree(len);
    if (!disk.ok) {
      cancelBody(request);
      return fail("INSUFFICIENT_STORAGE", "The storage disk is too low on free space to accept this chunk.");
    }

    // Cut the file back to exactly chunks 0..index-1 (drops any partial attempt).
    try {
      await provider.truncateChunkTemp(s.tmpObjId, offset);
    } catch (e) {
      cancelBody(request);
      if (e?.code === "ENOENT") {
        await closeSession(s, "failed", "UPLOAD_DATA_MISSING");
        return fail("UPLOAD_DATA_MISSING", "This upload's data is gone. Start the upload again.");
      }
      logError("chunk.append.truncate", ids, e);
      return storageErrorResponse(e);
    }

    const hash = crypto.createHash("sha256");
    let received = 0;
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        received += chunk.length;
        if (received > len) return cb(Object.assign(new Error("chunk too large"), { code: "CHUNK_TOO_LARGE" }));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    wrote = true;
    const tA = performance.now();
    try {
      const src = Readable.fromWeb(request.body);
      const ws = provider.openChunkWrite(s.tmpObjId, offset);
      // Superseded by a retry: close OUR file handle (no byte of this attempt can
      // be written after that) and stop — without waiting on the dead socket,
      // whose pending read may never settle.
      const superseded = new Promise((_, reject) => {
        abort.signal.addEventListener(
          "abort",
          () => {
            const stop = () => reject(Object.assign(new Error("superseded"), { code: "SUPERSEDED" }));
            if (ws.closed) stop();
            else ws.once("close", stop);
            ws.destroy();
            src.destroy();
          },
          { once: true },
        );
      });
      superseded.catch(() => {});
      const piping = pipeline(src, meter, ws);
      piping.catch(() => {}); // settled through the race below
      await Promise.race([piping, superseded]);
    } catch (e) {
      await provider.truncateChunkTemp(s.tmpObjId, offset).catch(() => {});
      if (abort.signal.aborted) {
        logIncomplete(ids, received, len, tA, "superseded by a retry of the same chunk");
        return fail("CHUNK_INTERRUPTED", `Chunk ${index} was superseded by a newer attempt.`, { details: { index, receivedBytes: received, expectedBytes: len } });
      }
      if (e?.code === "CHUNK_TOO_LARGE") return fail("CHUNK_SIZE_MISMATCH", `Chunk ${index} must be exactly ${len} bytes.`, { details: { expectedBytes: len } });
      if (["ENOSPC", "EPERM", "EACCES", "EBUSY", "EIO", "EROFS"].includes(e?.code)) {
        logError("chunk.append.write", ids, e);
        return storageErrorResponse(e);
      }
      // The body stream broke (client/proxy/tunnel dropped it). Record how much
      // actually arrived — the evidence for WHERE a chunk is being lost.
      logIncomplete(ids, received, len, tA, e?.code || e?.name);
      return fail("CHUNK_INTERRUPTED", `Chunk ${index} did not arrive completely (${received} of ${len} bytes). Retry it.`, {
        details: { index, receivedBytes: received, expectedBytes: len },
      });
    }

    if (received !== len) {
      await provider.truncateChunkTemp(s.tmpObjId, offset).catch(() => {});
      logIncomplete(ids, received, len, tA, "SHORT_BODY");
      return fail("CHUNK_SIZE_MISMATCH", `Chunk ${index} must be exactly ${len} bytes (got ${received}).`, { details: { index, receivedBytes: received, expectedBytes: len } });
    }
    const digest = hash.digest("hex");
    if (digest !== claimed) {
      await provider.truncateChunkTemp(s.tmpObjId, offset).catch(() => {});
      return fail("CHUNK_CHECKSUM_MISMATCH", `Chunk ${index} was corrupted in transit (checksum mismatch). Retry it.`, { details: { index } });
    }

    const tB = performance.now();
    // Durable before acknowledged: an accepted chunk survives a crash/restart.
    try {
      await provider.syncChunkTemp(s.tmpObjId);
    } catch (e) {
      await provider.truncateChunkTemp(s.tmpObjId, offset).catch(() => {});
      logError("chunk.append.sync", ids, e);
      return storageErrorResponse(e);
    }

    const expiresAt = newExpiry();
    const updated = await UploadSession.findOneAndUpdate(
      { _id: s._id, status: "active", nextIndex: index },
      { $set: { nextIndex: index + 1, bytesReceived: offset + len, expiresAt }, $push: { chunkHashes: digest } },
      { new: true },
    );
    if (!updated) {
      await provider.truncateChunkTemp(s.tmpObjId, offset).catch(() => {});
      return fail("UPLOAD_SESSION_CLOSED", "The upload session changed while this chunk was written.");
    }
    wrote = false; // committed — nothing to roll back
    if (TIMING) {
      const tC = performance.now();
      console.log(`[chunk-timing] append#${index} bytes=${len} receive+hash+write=${(tB - tA).toFixed(0)}ms (${(len / 1048576 / ((tB - tA) / 1000)).toFixed(0)} MB/s) fsync+db=${(tC - tB).toFixed(0)}ms`);
    }
    renewHeldSlot(uploadId, expiresAt.getTime());
    return ok(progress(updated, { index, accepted: true, alreadyAccepted: false }));
  } catch (e) {
    if (wrote) await provider.truncateChunkTemp(s.tmpObjId, offset).catch(() => {});
    logError("chunk.append", ids, e);
    return storageErrorResponse(e);
  } finally {
    busy.delete(uploadId);
    if (inflight.get(uploadId) === mine) inflight.delete(uploadId);
    release();
  }
}

// ───────────────────────────── complete ─────────────────────────────
async function hashTempByChunks(objId, chunkSize) {
  const full = crypto.createHash("sha256");
  const chunkHashes = [];
  let cur = crypto.createHash("sha256");
  let inChunk = 0;
  let bytes = 0;
  for await (const buf of getStorageProvider().openChunkRead(objId, { highWaterMark: config.chunkVerifyReadBytes })) {
    full.update(buf);
    bytes += buf.length;
    let off = 0;
    while (off < buf.length) {
      const take = Math.min(chunkSize - inChunk, buf.length - off);
      cur.update(buf.subarray(off, off + take));
      inChunk += take;
      off += take;
      if (inChunk === chunkSize) {
        chunkHashes.push(cur.digest("hex"));
        cur = crypto.createHash("sha256");
        inChunk = 0;
      }
    }
  }
  if (inChunk > 0) chunkHashes.push(cur.digest("hex"));
  return { fullSha: full.digest("hex"), chunkHashes, bytes };
}

async function fileResponse(fileId, projectId) {
  const doc = await FileObject.findOne({ fileId, projectId });
  return ok({ file: doc ? doc.toMeta() : null, fileId, alreadyCompleted: true }, { status: 200 });
}

async function opComplete(request, actor, url) {
  const { session: s, error } = await loadOwned(url.searchParams.get("uploadId"), actor);
  if (error) return error;
  if (s.status === "completed" && s.fileId) return fileResponse(s.fileId, s.projectId); // idempotent
  const gate = await gateActive(s);
  if (gate) return gate;
  if (actor.project.status !== "active") return projectDisabled();

  const body = await request.json().catch(() => ({}));
  const manifest = String(body.manifestSha256 || "").toLowerCase();
  if (!SHA_RE.test(manifest)) return fail("VALIDATION_ERROR", "manifestSha256 (64 hex characters) is required.");
  const fullExpected = body.sha256 != null ? String(body.sha256).toLowerCase() : s.expectedSha256;
  if (fullExpected && !SHA_RE.test(fullExpected)) return fail("VALIDATION_ERROR", "sha256 must be 64 hex characters.");

  // Every byte must be in: otherwise the session stays resumable.
  if (s.nextIndex !== s.totalChunks || s.bytesReceived !== s.declaredSize) {
    return fail("SIZE_MISMATCH", `Only ${s.bytesReceived} of ${s.declaredSize} bytes have been accepted. Upload chunk ${s.nextIndex} next.`, {
      details: { bytesReceived: s.bytesReceived, declaredSize: s.declaredSize, nextIndex: s.nextIndex, totalChunks: s.totalChunks },
    });
  }
  // Quota pre-check keeps the session resumable (raise the quota and complete
  // again). The atomic gate that decides a race is still commitStorage().
  if (quotaWouldExceed(actor.project, s.declaredSize)) {
    return fail("STORAGE_QUOTA_EXCEEDED", "This upload would exceed the project storage quota.");
  }
  if (busy.has(s.uploadId)) return fail("CHUNK_IN_PROGRESS", "A chunk is still being written. Retry shortly.");

  // Claim the finalize: exactly one caller moves active → completing.
  const claimed = await UploadSession.findOneAndUpdate(
    { _id: s._id, status: "active" },
    { $set: { status: "completing", completingAt: new Date() } },
    { new: true },
  );
  if (!claimed) return fail("UPLOAD_FINALIZING", "This upload is being finalized.");

  const provider = getStorageProvider();
  const ids = { uploadId: claimed.uploadId, projectId: claimed.projectId }; // for log lines (never paths)
  const closed = { done: false };
  const finish = async (status, failureCode) => {
    if (!closed.done) {
      closed.done = true;
      await closeSession(claimed, status, failureCode);
    }
  };
  try {
    const st = await provider.statChunkTemp(claimed.tmpObjId);
    if (!st) {
      await finish("failed", "UPLOAD_DATA_MISSING");
      return fail("UPLOAD_DATA_MISSING", "This upload's data is gone. Start the upload again.");
    }
    // Recompute everything from the bytes that are actually on disk. A transient
    // read error must not destroy the upload: hand the session back as active so
    // complete can simply be retried.
    let onDisk;
    const tV = performance.now();
    try {
      onDisk = await hashTempByChunks(claimed.tmpObjId, claimed.chunkSize);
    } catch (e) {
      closed.done = true; // session stays live (slot kept)
      await UploadSession.updateOne({ _id: claimed._id, status: "completing" }, { $set: { status: "active", completingAt: null } });
      logError("chunk.complete.verify", ids, e);
      return fail("STORAGE_UNAVAILABLE", "Could not read the uploaded data to verify it. Retry complete.");
    }
    const chunksMatch =
      onDisk.bytes === claimed.declaredSize &&
      onDisk.chunkHashes.length === claimed.chunkHashes.length &&
      onDisk.chunkHashes.every((h, i) => h === claimed.chunkHashes[i]);
    const manifestMatch = manifestSha256(onDisk.chunkHashes) === manifest;
    const fullMatch = !fullExpected || onDisk.fullSha === fullExpected;
    if (!chunksMatch || !manifestMatch || !fullMatch) {
      await finish("failed", "CHECKSUM_MISMATCH");
      const which = !chunksMatch ? "stored data" : !manifestMatch ? "manifest" : "full-file sha256";
      return fail("CHECKSUM_MISMATCH", `Upload checksum did not match (${which}). Nothing was stored.`);
    }

    // Promote atomically, apply the quota atomically, write metadata — the proven
    // single-shot path. On any failure finalize() removes the bytes and rolls the
    // quota back itself.
    const tF = performance.now();
    const r = await finalize({
      result: { handle: provider.chunkTempHandle(claimed.tmpObjId), bytes: onDisk.bytes, sha256: onDisk.fullSha },
      filename: claimed.originalName,
      claimedMime: claimed.mimeType,
      fields: {},
      project: actor.project,
      apiKey: actor.plane === "api" ? actor.apiKey : null,
      user: actor.plane === "dashboard" ? actor.user : null,
      logIds: { uploadId: claimed.uploadId },
    });
    if (TIMING) console.log(`[chunk-timing] complete bytes=${onDisk.bytes} verify(read+2×sha)=${(tF - tV).toFixed(0)}ms (${(onDisk.bytes / 1048576 / ((tF - tV) / 1000)).toFixed(0)} MB/s) finalize=${(performance.now() - tF).toFixed(0)}ms`);
    if (!r.ok) {
      recordError(actor.project, actor.plane === "api" ? actor.apiKey : null);
      await finish("failed", r.code);
      return fail(r.code, r.message);
    }
    closed.done = true;
    releaseHeldSlot(claimed.uploadId);
    // The file IS committed at this point — recording that on the session is
    // best-effort and must never turn a success into an error.
    await UploadSession.updateOne({ _id: claimed._id }, { $set: { status: "completed", fileId: r.doc.fileId, purgeAt: retentionDate() } }).catch((e) =>
      logError("chunk.complete.mark", { ...ids, fileId: r.doc.fileId }, e),
    );
    return ok({ file: r.doc.toMeta(), fileId: r.doc.fileId }, { status: 201 });
  } catch (e) {
    logError("chunk.complete", ids, e);
    await finish("failed", "STORAGE_UNAVAILABLE");
    return fail("STORAGE_UNAVAILABLE", "Could not finalize the upload.");
  }
}

// ───────────────────────────── status / list / abort ─────────────────────────────
async function opStatus(actor, url) {
  const { session: s, error } = await loadOwned(url.searchParams.get("uploadId"), actor);
  if (error) return error;
  if (isExpired(s)) await closeSession(s, "expired");
  else if (s.status === "completing") await recoverStaleCompleting(s);
  // inProgress: a chunk attempt is still streaming into this upload right now.
  return ok(withPolicy({ ...s.toPublic(), inProgress: busy.has(s.uploadId) }));
}

async function opList(actor) {
  const q = { projectId: actor.project._id, plane: actor.plane, status: "active", expiresAt: { $gt: new Date() } };
  if (actor.plane === "dashboard") q.ownerUserId = actor.user._id;
  else q.ownerApiKeyId = actor.apiKey._id;
  const rows = await UploadSession.find(q).sort({ updatedAt: -1 }).limit(50);
  return ok({ sessions: rows.map((r) => r.toPublic()) });
}

async function opAbort(actor, url) {
  const { session: s, error } = await loadOwned(url.searchParams.get("uploadId"), actor);
  if (error) return error;
  if (s.status === "completing") return fail("UPLOAD_FINALIZING", "This upload is being finalized.");
  if (s.status === "active") await closeSession(s, isExpired(s) ? "expired" : "aborted");
  return ok({ uploadId: s.uploadId, status: s.status, aborted: s.status === "aborted" });
}

/**
 * The one handler both planes call AFTER authenticating.
 *   actor = { plane: "dashboard"|"api", project, user?, apiKey? }
 * POST ?op=begin | append | complete | abort      GET ?op=status | list
 * The contract is documented in docs/chunked-upload-api.md.
 */
export async function handleChunkRequest(request, actor) {
  const res = await dispatchChunkOp(request, actor);
  if (res.status >= 400) {
    // Put the stable error code in the request log (the dashboard's Requests
    // page), so a failed chunk says WHY — not just "400".
    const code = await res
      .clone()
      .json()
      .then((j) => j?.error?.code, () => null);
    if (code) setLogCtx(request, { errorCode: code });
  }
  return res;
}

async function dispatchChunkOp(request, actor) {
  const url = new URL(request.url);
  const op = url.searchParams.get("op");
  await connectDB();
  await ensureRehydrated();

  // Both planes refuse every op on an inactive project (the API-key plane already
  // does so in authenticateApiKey; the dashboard plane must match it). The
  // session and its temp data are kept: re-enable before expiry and it resumes.
  if (actor.project.status !== "active") {
    cancelBody(request);
    return projectDisabled();
  }

  if (request.method === "GET") {
    if (op === "status") return opStatus(actor, url);
    if (op === "list") return opList(actor);
    return fail("VALIDATION_ERROR", "GET supports op=status | list.");
  }
  if (op === "begin") return opBegin(request, actor);
  if (op === "append") return opAppend(request, actor, url);
  if (op === "complete") return opComplete(request, actor, url);
  if (op === "abort") return opAbort(actor, url);
  if (op === "status") return opStatus(actor, url);
  cancelBody(request);
  return fail("VALIDATION_ERROR", "Unknown op. Use begin | append | complete | abort | status | list.");
}
