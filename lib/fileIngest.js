// lib/fileIngest.js
// The ONE upload path, shared by the API-key plane (/api/v1) and the session
// dashboard plane (/api/dashboard). Streams (multipart OR raw octet-stream),
// checksums in the same pass, commits atomically, writes metadata, and rolls
// the bytes back if metadata fails. Returns a plain result object; the route
// turns it into an HTTP response.

import path from "path";
import { Readable } from "stream";
import busboy from "busboy";
import mime from "mime-types";

import config from "@/lib/config";
import { streamToStorage } from "@/lib/uploadStream";
import getStorageProvider from "@/lib/storage/provider";
import FileObject from "@/lib/db/models/FileObject";
import { newFileId } from "@/lib/ids";
import { recordUploadTelemetry } from "@/lib/services/usageService";
import { commitStorage, releaseStorage, quotaHeadroom, checkDiskFree } from "@/lib/services/quotaService";
import { logError } from "@/lib/logSafe";
import { withProjectWrite, trackTransfer, PROJECT_DELETING_MESSAGE } from "@/lib/projectGuard";

function sanitizeName(name) {
  const n = String(name || "upload.bin")
    .replace(/[\r\n\x00-\x1f\x7f]/g, "")
    .replace(/[\\/]+/g, "_")
    .trim();
  return (n || "upload.bin").slice(0, 400);
}
function extOf(name) {
  return path.extname(String(name || "")).slice(1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
}
function resolveMime(ext, claimed) {
  const byExt = ext ? mime.lookup(ext) : false;
  if (byExt) return byExt;
  const c = String(claimed || "").toLowerCase().trim();
  if (c && c !== "application/octet-stream" && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(c)) return c;
  return "application/octet-stream";
}
function parseFolder(v) {
  if (!v) return [];
  return String(v).split("/").map((s) => s.trim()).filter(Boolean).slice(0, 12);
}
function parseTags(v) {
  if (!v) return [];
  return String(v).split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
}
function decodeHeaderFilename(v) {
  if (!v) return "";
  try {
    return decodeURIComponent(String(v));
  } catch {
    return String(v);
  }
}
function uploaderLabel({ apiKey, user }) {
  if (apiKey) return `${apiKey.name} (${apiKey.env})`;
  if (user) return `Dashboard · ${user.email}`;
  return "unknown";
}

export async function finalize({ result, filename, claimedMime, fields, project, apiKey, user, logIds = {} }) {
  const provider = getStorageProvider();
  // Identifiers for server-log lines (never paths); callers may add e.g. uploadId.
  const ids = { projectId: project?._id, ...logIds };
  // Optional, opt-in per-stage timing (UPLOAD_TIMING=1). No-op otherwise — the hot
  // path is untouched. The stream/receive/SHA time is the request time minus these.
  const T = /^(1|true|yes|on)$/i.test(process.env.UPLOAD_TIMING || "") ? { s: performance.now() } : null;
  if (!result || result.bytes === 0) {
    if (result?.handle) await provider.abort(result.handle);
    return { ok: false, code: "INVALID_UPLOAD", message: "The uploaded file was empty." };
  }

  // Commit inside the project's write fence: once a permanent deletion has
  // started nothing new lands in the project, and a commit already under way
  // finishes before the deletion takes stock (lib/projectGuard).
  const run = await withProjectWrite(project._id, () =>
    commitUpload({ result, filename, claimedMime, fields, project, apiKey, user, provider, ids, T }),
  );
  if (run.fenced) {
    await provider.abort(result.handle);
    return { ok: false, code: "PROJECT_DELETING", message: PROJECT_DELETING_MESSAGE };
  }
  return run.value;
}

async function commitUpload({ result, filename, claimedMime, fields, project, apiKey, user, provider, ids, T }) {
  const originalName = sanitizeName(filename || fields.name || "upload.bin");
  const extension = extOf(originalName);
  const mimeType = resolveMime(extension, claimedMime);
  const folderPath = parseFolder(fields.folderPath);
  const tags = parseTags(fields.tags);

  let committed;
  try {
    committed = await provider.commit(result.handle, { projectId: project._id });
    if (T) T.commit = performance.now();
  } catch (e) {
    await provider.abort(result.handle);
    logError("ingest.commit", ids, e);
    return { ok: false, code: "STORAGE_UNAVAILABLE", message: "Could not store the file." };
  }

  // Atomic quota gate (race-safe): only add to active storage if within quota.
  // A concurrent upload that would push the project over is rejected HERE and
  // its bytes rolled back — the mid-stream limit is only an optimisation.
  const within = await commitStorage(project._id, committed.bytes);
  if (T) T.quota = performance.now();
  if (!within) {
    await provider.remove(committed.storageKey).catch(() => {});
    return { ok: false, code: "STORAGE_QUOTA_EXCEEDED", message: "This upload would exceed the project storage quota." };
  }

  let doc;
  try {
    doc = await FileObject.create({
      fileId: newFileId(),
      projectId: project._id,
      uploadedByApiKeyId: apiKey ? apiKey._id : null,
      uploadedByUserId: user ? user._id : null,
      uploadedByLabel: uploaderLabel({ apiKey, user }),
      originalName,
      storageKey: committed.storageKey,
      mimeType,
      extension,
      sizeBytes: committed.bytes,
      checksumSha256: result.sha256,
      storageProvider: provider.name || "local",
      status: "active",
      folderPath,
      tags,
      metadata: {},
    });
    if (T) { T.meta = performance.now(); console.log(`[upload-timing] bytes=${committed.bytes} commit=${(T.commit - T.s).toFixed(0)}ms quota=${(T.quota - T.commit).toFixed(0)}ms mongo=${(T.meta - T.quota).toFixed(0)}ms  (stream+receive+SHA = request time minus these)`); }
  } catch (e) {
    await releaseStorage(project._id, committed.bytes); // undo the quota reservation
    // A failed rollback leaves stray bytes: name them by storageKey (relative to
    // the data dir, never an absolute path) so maintenance can find them.
    await provider.remove(committed.storageKey).catch((re) => logError("ingest.orphan", { ...ids, storageKey: committed.storageKey }, re));
    logError("ingest.metadata", ids, e);
    return { ok: false, code: "STORAGE_UNAVAILABLE", message: "Could not finalize the upload." };
  }

  recordUploadTelemetry(project, apiKey || null, committed.bytes); // best-effort historical counters
  return { ok: true, doc };
}

function limitMessage(code) {
  return code === "STORAGE_QUOTA_EXCEEDED"
    ? "This upload would exceed the project storage quota."
    : `File exceeds the maximum upload size of ${config.maxUploadBytes} bytes.`;
}

async function ingestRaw(request, ctx, opts) {
  const source = Readable.fromWeb(request.body);
  const filename = decodeHeaderFilename(request.headers.get("x-file-name")) || "upload.bin";
  const claimedMime = String(request.headers.get("x-file-type") || request.headers.get("content-type") || "").split(";")[0].trim();
  let result;
  try {
    result = await streamToStorage(source, opts);
  } catch (e) {
    if (e.code === "STORAGE_QUOTA_EXCEEDED") return { ok: false, code: "STORAGE_QUOTA_EXCEEDED", message: limitMessage(e.code) };
    if (e.code === "FILE_TOO_LARGE") return { ok: false, code: "FILE_TOO_LARGE", message: limitMessage(e.code) };
    return { ok: false, code: "INVALID_UPLOAD", message: "The upload stream failed." };
  }
  return finalize({ result, filename, claimedMime, fields: {}, ...ctx });
}

function ingestMultipart(request, ct, ctx, opts) {
  return new Promise((resolve) => {
    const source = Readable.fromWeb(request.body);
    let bb;
    try {
      bb = busboy({ headers: { "content-type": ct }, limits: { files: 1, fields: 20 } });
    } catch {
      resolve({ ok: false, code: "INVALID_UPLOAD", message: "Invalid multipart request." });
      return;
    }
    const fields = {};
    let handled = false;
    let storing = null;
    let fileInfo = null;
    let closing = false;
    let answered = false;
    const answer = (r) => {
      if (!answered) {
        answered = true;
        resolve(r);
      }
    };
    bb.on("field", (n, v) => {
      if (n && v != null && String(v).length < 10000) fields[n] = String(v);
    });
    bb.on("file", (_f, stream, info) => {
      if (handled) {
        stream.resume();
        return;
      }
      handled = true;
      fileInfo = info;
      storing = streamToStorage(stream, opts);
      storing.catch(() => {}); // settled below; never an unhandled rejection
    });
    // Cancelled (project being deleted): stop reading; streamToStorage aborts on
    // the same signal and removes its .part (or a finished .part is discarded
    // here) — answer once that is done. Once busboy has closed, the finalize
    // below is already running and refuses on its own.
    opts.signal?.addEventListener(
      "abort",
      () => {
        if (closing || answered) return;
        source.unpipe(bb);
        source.destroy();
        const cleaned = storing ? storing.then((r) => getStorageProvider().abort(r.handle), () => {}) : Promise.resolve();
        cleaned.then(() => answer({ ok: false, code: "PROJECT_DELETING", message: PROJECT_DELETING_MESSAGE }));
      },
      { once: true },
    );
    bb.on("error", () => answer({ ok: false, code: "INVALID_UPLOAD", message: "The multipart stream failed." }));
    bb.on("close", async () => {
      closing = true;
      if (!handled || !storing) {
        answer({ ok: false, code: "INVALID_UPLOAD", message: "No file field found in the upload." });
        return;
      }
      try {
        const result = await storing;
        answer(await finalize({ result, filename: fileInfo?.filename, claimedMime: fileInfo?.mimeType, fields, ...ctx }));
      } catch (e) {
        if (e.code === "STORAGE_QUOTA_EXCEEDED") answer({ ok: false, code: "STORAGE_QUOTA_EXCEEDED", message: limitMessage(e.code) });
        else if (e.code === "FILE_TOO_LARGE") answer({ ok: false, code: "FILE_TOO_LARGE", message: limitMessage(e.code) });
        else answer({ ok: false, code: "INVALID_UPLOAD", message: "The upload failed." });
      }
    });
    source.on("error", () => {});
    source.pipe(bb);
  });
}

/**
 * Ingest an upload from a Request into `project`, attributed to `apiKey` (machine)
 * or `user` (dashboard). Returns { ok:true, doc } or { ok:false, code, message }.
 */
export async function ingestUpload(request, ctx) {
  if (!request.body) return { ok: false, code: "INVALID_UPLOAD", message: "No request body." };

  // Disk safety (independent of quota, plan §23/§24): refuse if free space would
  // drop below the floor. Content-Length used when present.
  const contentLength = Number(request.headers.get("content-length") || 0);
  const disk = await checkDiskFree(contentLength);
  if (!disk.ok) {
    return { ok: false, code: "INSUFFICIENT_STORAGE", message: "The storage disk is too low on free space to accept this upload." };
  }

  // Effective per-upload limit = min(global max, remaining quota headroom).
  const headroom = quotaHeadroom(ctx.project); // Infinity when unlimited
  const maxBytes = Math.min(config.maxUploadBytes, headroom);
  const limitCode = headroom < config.maxUploadBytes ? "STORAGE_QUOTA_EXCEEDED" : "FILE_TOO_LARGE";
  // A permanent deletion of the project cancels this upload mid-stream and waits
  // until its temp file is gone (lib/projectGuard); refused if one has started.
  const cancel = new AbortController();
  const untrack = trackTransfer(ctx.project._id, () => cancel.abort(), "upload");
  if (!untrack) return { ok: false, code: "PROJECT_DELETING", message: PROJECT_DELETING_MESSAGE };
  const opts = { maxBytes, limitCode, signal: cancel.signal };
  try {
    const ct = request.headers.get("content-type") || "";
    const r = /multipart\/form-data/i.test(ct) ? await ingestMultipart(request, ct, ctx, opts) : await ingestRaw(request, ctx, opts);
    if (cancel.signal.aborted && !r.ok) return { ok: false, code: "PROJECT_DELETING", message: PROJECT_DELETING_MESSAGE };
    return r;
  } finally {
    untrack();
  }
}
