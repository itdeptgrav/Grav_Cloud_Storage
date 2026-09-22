// lib/uploadClient.js
// Browser upload via XHR (for real byte-accurate progress; fetch has no upload
// progress). Hits the SESSION dashboard endpoint same-origin, so the httpOnly
// cookie is sent automatically — NO API key ever touches browser JS. The File
// is streamed by the browser; it is not read into JS memory.

export function uploadFileXHR(projectId, file, { onProgress, onDone } = {}) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
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
      if (onDone) onDone(result);
      resolve(result);
    };
    xhr.onerror = () => {
      const result = { ok: false, status: 0, error: "Network error during upload." };
      if (onDone) onDone(result);
      resolve(result);
    };
    xhr.send(file);
  });
}
