// lib/fileHttp.js
// HTTP helpers for serving stored objects: Range parsing, header-injection-safe
// Content-Disposition, and a streamed Response that COUNTS the bytes actually
// delivered (for accurate bandwidth accounting, incl. Range and client aborts).

import { Transform, Readable } from "stream";
import getStorageProvider from "@/lib/storage/provider";

/** Strip anything that could break an HTTP header or a filesystem path. */
export function sanitizeFilename(name) {
  let n = String(name || "file")
    .replace(/[\r\n]/g, "") // no CRLF header injection
    .replace(/[\u0000-\u001f\u007f]/g, "") // control chars
    .replace(/["\\]/g, "_"); // quotes/backslashes
  n = n.trim();
  return (n || "file").slice(0, 200);
}

/** RFC 6266 disposition with an ASCII fallback + UTF-8 filename*. */
export function contentDisposition(type, name) {
  const safe = sanitizeFilename(name);
  const ascii = safe.replace(/[^\u0020-\u007e]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/** Formats browsers render passively; everything else downloads. SVG excluded. */
export function inlineSafe(mime) {
  const m = String(mime || "").toLowerCase();
  return (
    (m.startsWith("image/") && m !== "image/svg+xml") ||
    m === "application/pdf" ||
    m.startsWith("video/") ||
    m.startsWith("audio/") ||
    m === "text/plain"
  );
}

/**
 * Parse a Range header against a known size.
 *  → { start, end, length }   satisfiable single range (inclusive)
 *  → { unsatisfiable: true }  valid syntax but out of bounds  → 416
 *  → { invalid: true }        malformed syntax                → ignore (200)
 *  → null                     no Range header
 * Supports bytes=a-b, bytes=a-, bytes=-n. Single range only.
 */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return { invalid: true };
  const sRaw = m[1];
  const eRaw = m[2];
  if (sRaw === "" && eRaw === "") return { invalid: true };

  let start;
  let end;
  if (sRaw === "") {
    // suffix: last N bytes
    const n = parseInt(eRaw, 10);
    if (Number.isNaN(n)) return { invalid: true };
    if (n === 0 || size === 0) return { unsatisfiable: true };
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(sRaw, 10);
    end = eRaw === "" ? size - 1 : parseInt(eRaw, 10);
    if (Number.isNaN(start) || Number.isNaN(end)) return { invalid: true };
    if (end > size - 1) end = size - 1;
  }
  if (start < 0 || start > end || start >= size) return { unsatisfiable: true };
  return { start, end, length: end - start + 1 };
}

// Wrap a node read stream so we can count delivered bytes, then hand the web
// stream to Response. onServed(n) fires once when delivery ends (or is aborted).
function countingResponse(nodeStream, { status, headers, onServed }) {
  let n = 0;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try {
      onServed && onServed(n);
    } catch {
      /* best-effort */
    }
  };
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      n += chunk.length;
      cb(null, chunk);
    },
  });
  nodeStream.on("error", (e) => counter.destroy(e));
  counter.on("end", finish);
  counter.on("close", finish);
  nodeStream.pipe(counter);
  return new Response(Readable.toWeb(counter), { status, headers });
}

/**
 * Build the streamed Response for a file. Returns { response } or { missing:true }
 * when the physical object is gone (caller answers 404 + logs the orphan).
 */
export async function serveFile(file, request, { attachment = false, onServed, extraHeaders } = {}) {
  const provider = getStorageProvider();
  const st = await provider.stat(file.storageKey);
  if (!st) return { missing: true };
  const total = st.bytes;
  const mime = file.mimeType || "application/octet-stream";
  const dispType = attachment || !inlineSafe(mime) ? "attachment" : "inline";

  const headers = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": contentDisposition(dispType, file.originalName),
    // Private, authenticated bytes — never publicly/CDN cacheable.
    "Cache-Control": "private, no-store",
    ...(extraHeaders || {}),
  };

  const range = parseRange(request.headers.get("range"), total);

  if (range && range.unsatisfiable) {
    if (onServed) onServed(0);
    return {
      response: new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes", ...(extraHeaders || {}) },
      }),
    };
  }

  let status = 200;
  let readOpts = {};
  if (range && !range.invalid) {
    status = 206;
    readOpts = { start: range.start, end: range.end };
    headers["Content-Length"] = String(range.length);
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${total}`;
  } else {
    headers["Content-Length"] = String(total);
  }

  const nodeStream = provider.openRead(file.storageKey, readOpts);
  if (!nodeStream) return { missing: true };
  return { response: countingResponse(nodeStream, { status, headers, onServed }) };
}
