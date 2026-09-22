// lib/uploadStream.js
// Stream a readable source to storage while computing SHA-256 and counting
// bytes IN THE SAME PASS — the file is never buffered whole in memory, and it is
// never re-read to checksum it. Enforces a max size by aborting mid-stream.

import crypto from "crypto";
import getStorageProvider from "@/lib/storage/provider";

/**
 * @returns Promise<{ handle, bytes, sha256 }>  on success
 * @throws  Error with .code = "FILE_TOO_LARGE" | "UPLOAD_STREAM_ERROR" | "STORAGE_WRITE_ERROR"
 * On any failure the tmp .part is removed before rejecting.
 */
export function streamToStorage(source, { maxBytes } = {}) {
  const provider = getStorageProvider();
  const handle = provider.beginWrite();
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  let settled = false;

  return new Promise((resolve, reject) => {
    const fail = (code, err) => {
      if (settled) return;
      settled = true;
      try {
        source.destroy();
      } catch {
        /* ignore */
      }
      provider
        .abort(handle)
        .catch(() => {})
        .finally(() => reject(Object.assign(err || new Error(code), { code })));
    };

    source.on("data", (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      hash.update(chunk);
      if (maxBytes && bytes > maxBytes) fail("FILE_TOO_LARGE", new Error("File too large"));
    });
    source.on("error", (err) => fail("UPLOAD_STREAM_ERROR", err));
    handle.stream.on("error", (err) => fail("STORAGE_WRITE_ERROR", err));
    handle.stream.on("finish", () => {
      if (settled) return;
      settled = true;
      resolve({ handle, bytes, sha256: hash.digest("hex") });
    });

    source.pipe(handle.stream);
  });
}
