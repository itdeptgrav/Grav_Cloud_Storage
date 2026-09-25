// lib/chunkedUploads.js
// Resumable CHUNKED upload — for files larger than a proxy's per-request body cap
// (e.g. Cloudflare's ~100 MB). The client slices the file into < cap chunks and
// POSTs them IN ORDER; we append each chunk's bytes to ONE growing tmp file (the
// same beginWrite() handle a normal upload uses), keeping a running SHA-256, then
// hand the finished handle to finalize() — so commit, the atomic quota gate and
// the DB record all reuse the proven single-shot path. The reassembled file is
// therefore byte-identical (verified by size and, if the client sends it, sha256).
//
// State is in-memory (one Node process): a server restart cancels in-flight
// uploads; their tmp .part files are swept here (and by the normal tmp cleanup).
// Chunks MUST arrive in order (index 0,1,2…); the client sends them serially.

import crypto from "crypto";
import { Readable, Transform } from "stream";
import { ok, fail } from "@/lib/http";
import config from "@/lib/config";
import getStorageProvider from "@/lib/storage/provider";
import { finalize } from "@/lib/fileIngest";
import { quotaHeadroom, checkDiskFree } from "@/lib/services/quotaService";
import { acquireSlot } from "@/lib/limits";
import { recordError } from "@/lib/services/usageService";

export const CHUNK_SIZE = 80 * 1024 * 1024; // 80 MiB — safely under Cloudflare's ~100 MB cap
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // abandon an idle session after 6h
const MAX_ACTIVE = 200; // safety cap on concurrent sessions

const sessions = new Map(); // uploadId -> entry

function sweep() {
  const now = Date.now();
  for (const [id, e] of sessions) {
    if (now - e.touchedAt > SESSION_TTL_MS) {
      getStorageProvider().abort(e.handle).catch(() => {});
      sessions.delete(id);
    }
  }
}

function begin({ project, user, apiKey, filename, size, mimeType }) {
  sweep();
  const provider = getStorageProvider();
  const headroom = quotaHeadroom(project); // Infinity when the project is unlimited
  const maxBytes = Math.min(config.maxUploadBytes, headroom);
  const limitCode = headroom < config.maxUploadBytes ? "STORAGE_QUOTA_EXCEEDED" : "FILE_TOO_LARGE";
  const handle = provider.beginWrite(); // one tmp .part file for the whole upload
  const entry = {
    uploadId: "up_" + crypto.randomBytes(18).toString("hex"),
    projectId: String(project._id),
    user: user || null,
    apiKey: apiKey || null,
    filename: filename || "upload.bin",
    mimeType: mimeType || "application/octet-stream",
    declaredSize: Number.isFinite(size) && size > 0 ? size : null,
    handle,
    hash: crypto.createHash("sha256"),
    received: 0,
    nextIndex: 0,
    maxBytes,
    limitCode,
    busy: false,
    error: null,
    touchedAt: Date.now(),
  };
  handle.stream.on("error", (e) => { entry.error = e; }); // surface a disk write error to the next op
  sessions.set(entry.uploadId, entry);
  return entry;
}

// Append one chunk (a whole HTTP request body) to the growing tmp file, in order.
function appendChunk(entry, webBody, index) {
  return new Promise((resolve, reject) => {
    if (entry.error) return reject(entry.error);
    if (entry.busy) return reject(Object.assign(new Error("busy"), { code: "CHUNK_BUSY" }));
    if (index != null && Number(index) !== entry.nextIndex)
      return reject(Object.assign(new Error("out of order"), { code: "BAD_CHUNK_INDEX", expected: entry.nextIndex }));
    entry.busy = true;
    entry.touchedAt = Date.now();

    const source = Readable.fromWeb(webBody);
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        entry.received += chunk.length;
        entry.hash.update(chunk);
        if (entry.received > entry.maxBytes) return cb(Object.assign(new Error("limit"), { code: entry.limitCode }));
        cb(null, chunk);
      },
    });
    const onDestErr = (e) => finish(e);
    const finish = (err) => {
      entry.busy = false;
      entry.handle.stream.removeListener("error", onDestErr);
      if (err) { entry.error = err; return reject(err); }
      entry.nextIndex += 1;
      entry.touchedAt = Date.now();
      resolve({ received: entry.received, nextIndex: entry.nextIndex });
    };
    source.on("error", finish);
    counter.on("error", finish);
    entry.handle.stream.once("error", onDestErr);
    counter.on("end", () => finish());
    source.pipe(counter);
    counter.pipe(entry.handle.stream, { end: false }); // keep the tmp file open for the next chunk
  });
}

async function complete(entry, { sha256 } = {}) {
  await new Promise((resolve, reject) => {
    entry.handle.stream.once("error", reject);
    entry.handle.stream.end(resolve);
  });
  const digest = entry.hash.digest("hex");
  if (sha256 && String(sha256).toLowerCase() !== digest) {
    throw Object.assign(new Error("checksum mismatch"), { code: "CHECKSUM_MISMATCH" });
  }
  if (entry.declaredSize != null && entry.received !== entry.declaredSize) {
    throw Object.assign(new Error("size mismatch"), { code: "SIZE_MISMATCH", received: entry.received, declared: entry.declaredSize });
  }
  return { handle: entry.handle, bytes: entry.received, sha256: digest };
}

async function discard(entry) {
  try { await getStorageProvider().abort(entry.handle); } catch { /* already gone */ }
  sessions.delete(entry.uploadId);
}

/**
 * The one handler both planes call AFTER authenticating.
 *   ?op=begin    JSON { filename, size, mimeType }        → { uploadId, chunkSize }
 *   ?op=append   &uploadId&index  raw chunk body          → { received, nextIndex }
 *   ?op=complete &uploadId        JSON { sha256? }         → { file, fileId }
 *   ?op=abort    &uploadId                                 → { aborted:true }
 * `actor` is { project, user? , apiKey? }.
 */
export async function handleChunkRequest(request, { project, user = null, apiKey = null }) {
  const url = new URL(request.url);
  const op = url.searchParams.get("op");

  if (op === "begin") {
    if (sessions.size >= MAX_ACTIVE) { sweep(); if (sessions.size >= MAX_ACTIVE) return fail("TOO_MANY_CONCURRENT_TRANSFERS", "Too many uploads in progress. Try again shortly."); }
    const body = await request.json().catch(() => ({}));
    const size = Number(body.size) || 0;
    const disk = await checkDiskFree(size);
    if (!disk.ok) return fail("INSUFFICIENT_STORAGE", "The storage disk is too low on free space to accept this upload.");
    if (size && size > quotaHeadroom(project)) return fail("STORAGE_QUOTA_EXCEEDED", "This upload would exceed the project storage quota.");
    const entry = begin({ project, user, apiKey, filename: body.filename, size, mimeType: body.mimeType });
    return ok({ uploadId: entry.uploadId, chunkSize: CHUNK_SIZE }, { status: 201 });
  }

  const uploadId = url.searchParams.get("uploadId");
  const entry = uploadId ? sessions.get(uploadId) : null;
  if (!entry) return fail("NOT_FOUND", "Upload session not found or expired.");
  if (entry.projectId !== String(project._id)) return fail("FORBIDDEN", "This upload session belongs to a different project.");

  if (op === "append") {
    if (!request.body) return fail("INVALID_UPLOAD", "No chunk body.");
    try {
      return ok(await appendChunk(entry, request.body, url.searchParams.get("index")));
    } catch (e) {
      if (e.code === "BAD_CHUNK_INDEX") return fail("VALIDATION_ERROR", `Out-of-order chunk; expected index ${e.expected}.`);
      if (e.code === "CHUNK_BUSY") return fail("CONFLICT", "A chunk is still being written; send chunks one at a time.");
      await discard(entry);
      if (e.code === "STORAGE_QUOTA_EXCEEDED") return fail("STORAGE_QUOTA_EXCEEDED", "This upload would exceed the project storage quota.");
      if (e.code === "FILE_TOO_LARGE") return fail("FILE_TOO_LARGE", "File exceeds the maximum upload size.");
      return fail("INVALID_UPLOAD", "The chunk upload failed.");
    }
  }

  if (op === "complete") {
    const slot = acquireSlot("upload", project._id);
    if (!slot.ok) return fail("TOO_MANY_CONCURRENT_TRANSFERS", `Too many concurrent uploads for this project (max ${slot.limit}).`);
    try {
      const body = await request.json().catch(() => ({}));
      let result;
      try {
        result = await complete(entry, { sha256: body.sha256 });
      } catch (e) {
        await discard(entry);
        if (e.code === "CHECKSUM_MISMATCH") return fail("INVALID_UPLOAD", "Upload checksum did not match — nothing was stored.");
        if (e.code === "SIZE_MISMATCH") return fail("INVALID_UPLOAD", `Received ${e.received} bytes but expected ${e.declared} — nothing was stored.`);
        return fail("INVALID_UPLOAD", "Could not finalize the upload.");
      }
      const r = await finalize({ result, filename: entry.filename, claimedMime: entry.mimeType, fields: {}, project, apiKey: entry.apiKey, user: entry.user });
      sessions.delete(entry.uploadId);
      if (!r.ok) { recordError(project, entry.apiKey || null); return fail(r.code, r.message); }
      return ok({ file: r.doc.toMeta(), fileId: r.doc.fileId }, { status: 201 });
    } finally {
      slot.release();
    }
  }

  if (op === "abort") { await discard(entry); return ok({ aborted: true }); }

  return fail("VALIDATION_ERROR", "Unknown chunk op. Use begin | append | complete | abort.");
}
