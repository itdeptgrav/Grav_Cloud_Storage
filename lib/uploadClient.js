// lib/uploadClient.js
// Browser upload to the SESSION dashboard plane, same-origin (httpOnly cookie is
// sent automatically — NO API key ever touches browser JS). The File is streamed
// by the browser, never read into JS memory.
//
// Small files → one XHR POST (byte-accurate progress).
// Large files → CHUNKED upload: the file is sliced into < CHUNK_SIZE pieces sent
// in order, so no single request approaches a proxy's body cap (e.g. Cloudflare's
// ~100 MB). The server reassembles + checksums them (see lib/chunkedUploads.js).
// Either way the public contract is identical: uploadFileXHR(projectId, file,
// { onProgress(loaded,total), onDone({ ok, file, fileId, error, code }) }).

const CHUNK_SIZE = 80 * 1024 * 1024; // 80 MiB — must match/undercut the proxy cap

export function uploadFileXHR(projectId, file, opts = {}) {
  return file.size > CHUNK_SIZE
    ? uploadChunked(projectId, file, opts)
    : uploadSingle(projectId, file, opts);
}

// ---- small files: one streamed POST -----------------------------------------
function uploadSingle(projectId, file, { onProgress, onDone } = {}) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/dashboard/projects/${projectId}/files`, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name || "upload.bin"));
    if (file.type) xhr.setRequestHeader("x-file-type", file.type);

    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total); };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText || "{}"); } catch { /* non-JSON */ }
      const ok = xhr.status >= 200 && xhr.status < 300 && body.success;
      const result = ok
        ? { ok: true, file: body.data.file, fileId: body.data.fileId }
        : { ok: false, status: xhr.status, error: body?.error?.message || `Upload failed (HTTP ${xhr.status})`, code: body?.error?.code };
      if (onDone) onDone(result);
      resolve(result);
    };
    xhr.onerror = () => { const r = { ok: false, status: 0, error: "Network error during upload." }; if (onDone) onDone(r); resolve(r); };
    xhr.send(file);
  });
}

// ---- large files: chunked, in order -----------------------------------------
async function uploadChunked(projectId, file, { onProgress, onDone } = {}) {
  const base = `/api/dashboard/projects/${projectId}/files/chunk`;
  const done = (r) => { if (onDone) onDone(r); return r; };
  let uploadId = null;
  try {
    // begin
    const begin = await postJson(`${base}?op=begin`, {
      filename: file.name || "upload.bin",
      size: file.size,
      mimeType: file.type || "application/octet-stream",
    });
    uploadId = begin.uploadId;
    const chunkSize = begin.chunkSize || CHUNK_SIZE;

    // append each slice in order, reporting cumulative progress
    let sent = 0;
    let index = 0;
    for (let start = 0; start < file.size; start += chunkSize) {
      const blob = file.slice(start, Math.min(start + chunkSize, file.size));
      const base0 = sent;
      await putChunk(`${base}?op=append&uploadId=${uploadId}&index=${index}`, blob, (loaded) => {
        if (onProgress) onProgress(base0 + loaded, file.size);
      });
      sent += blob.size;
      index += 1;
      if (onProgress) onProgress(sent, file.size);
    }

    // complete → the final file record
    const data = await postJson(`${base}?op=complete&uploadId=${uploadId}`, {});
    return done({ ok: true, file: data.file, fileId: data.fileId });
  } catch (e) {
    if (uploadId) { try { await postJson(`${base}?op=abort&uploadId=${uploadId}`, {}); } catch { /* best effort */ } }
    return done({ ok: false, error: e.message || "Chunked upload failed", code: e.code, status: e.status });
  }
}

function postJson(url, body) {
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => {
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok || !json?.success) {
      const err = new Error(json?.error?.message || `Request failed (HTTP ${res.status})`);
      err.code = json?.error?.code; err.status = res.status;
      throw err;
    }
    return json.data;
  });
}

// XHR so we get byte-accurate progress within a chunk.
function putChunk(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded); };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText || "{}"); } catch { /* non-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.success) resolve(body.data);
      else { const err = new Error(body?.error?.message || `Chunk failed (HTTP ${xhr.status})`); err.code = body?.error?.code; err.status = xhr.status; reject(err); }
    };
    xhr.onerror = () => reject(new Error("Network error during chunk upload."));
    xhr.send(blob);
  });
}
