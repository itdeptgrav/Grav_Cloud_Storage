// @grav/storage-sdk — the official Grav Storage client for Node.js.
//
// STREAMING BY DESIGN: uploads pipe a source (file path / Readable / Buffer)
// straight to the server, and downloads pipe the response to disk/a stream —
// a ~900 MB transfer never sits in memory. JSON operations (meta/list/delete/
// usage) use fetch; byte transfers use node:http/https for guaranteed streaming.
//
// SECURITY: `apiKey` is a SERVER-SIDE secret. Never ship it to a browser / put
// it in NEXT_PUBLIC_* / commit it. Route browser traffic through your backend,
// which holds the key and calls this SDK.
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";

export class GravStorageError extends Error {
  constructor(message, { status, code, requestId } = {}) {
    super(message || "Grav Storage request failed");
    this.name = "GravStorageError";
    this.status = status;
    this.code = code; // stable machine code, e.g. FILE_NOT_FOUND
    this.requestId = requestId; // X-Request-ID, for correlating with server logs
  }
}

function mod(u) {
  return u.protocol === "https:" ? https : http;
}
function requestRaw(client, { method, pathname, headers, bodyStream, bodyBuffer }) {
  return new Promise((resolve, reject) => {
    const u = new URL(client.baseUrl + pathname);
    const req = mod(u).request(u, { method, headers: client._headers(headers) }, resolve);
    if (client.timeoutMs) req.setTimeout(client.timeoutMs, () => req.destroy(new GravStorageError("Request timed out", { code: "TIMEOUT" })));
    req.on("error", reject);
    if (bodyStream) {
      bodyStream.on("error", (e) => { req.destroy(e); reject(e); });
      bodyStream.pipe(req);
    } else if (bodyBuffer !== undefined) {
      req.end(bodyBuffer);
    } else {
      req.end();
    }
  });
}
async function readJson(res) {
  let b = "";
  for await (const c of res) b += c;
  try {
    return JSON.parse(b);
  } catch {
    return null;
  }
}
async function throwIfError(res) {
  if (res.statusCode >= 400) {
    const j = await readJson(res);
    throw new GravStorageError(j?.error?.message || `Request failed (${res.statusCode})`, {
      status: res.statusCode,
      code: j?.error?.code,
      requestId: res.headers["x-request-id"],
    });
  }
}

class FilesApi {
  constructor(client) {
    this.c = client;
  }

  /** Upload a file. source = path string | Node Readable | Buffer. Streams. */
  async upload(source, { name, contentType, size } = {}) {
    let stream;
    let bodyBuffer;
    let fname = name;
    let len = size;
    if (typeof source === "string") {
      const st = fs.statSync(source);
      len = st.size;
      fname = name || path.basename(source);
      stream = fs.createReadStream(source);
    } else if (Buffer.isBuffer(source)) {
      len = source.length;
      fname = name || "upload.bin";
      bodyBuffer = source;
    } else if (source && typeof source.pipe === "function") {
      stream = source;
      fname = name || "upload.bin";
    } else {
      throw new GravStorageError("upload(source): source must be a path, Readable, or Buffer");
    }
    const headers = { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(fname) };
    if (contentType) headers["x-file-type"] = contentType;
    if (typeof len === "number") headers["content-length"] = String(len);
    const res = await requestRaw(this.c, { method: "POST", pathname: "/api/v1/files", headers, bodyStream: stream, bodyBuffer });
    await throwIfError(res);
    return (await readJson(res)).data;
  }

  /** Open a read stream for a file. Returns { stream, status, contentType,
   *  contentLength, contentRange, requestId }. Pass { range: "bytes=0-1023" }. */
  async get(fileId, { range } = {}) {
    const headers = {};
    if (range) headers.range = range;
    const res = await requestRaw(this.c, { method: "GET", pathname: `/api/v1/files/${encodeURIComponent(fileId)}`, headers });
    await throwIfError(res); // consumes body + throws on 4xx; leaves stream intact on 200/206
    return {
      status: res.statusCode,
      contentType: res.headers["content-type"],
      contentLength: res.headers["content-length"] ? Number(res.headers["content-length"]) : undefined,
      contentRange: res.headers["content-range"],
      acceptRanges: res.headers["accept-ranges"],
      requestId: res.headers["x-request-id"],
      stream: res,
    };
  }

  /** Download to a file path or a Writable stream. Streams; returns { bytes }. */
  async download(fileId, dest, { range } = {}) {
    const { stream, status } = await this.get(fileId, { range });
    const out = typeof dest === "string" ? fs.createWriteStream(dest) : dest;
    let bytes = 0;
    stream.on("data", (c) => (bytes += c.length));
    await new Promise((resolve, reject) => {
      stream.on("error", reject);
      out.on("error", reject);
      out.on("finish", resolve);
      stream.pipe(out);
    });
    return { bytes, status };
  }

  async meta(fileId) {
    return (await this.c._json("GET", `/api/v1/files/${encodeURIComponent(fileId)}/meta`)).data.file;
  }
  async list(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return (await this.c._json("GET", `/api/v1/files${qs ? `?${qs}` : ""}`)).data;
  }
  async delete(fileId) {
    return (await this.c._json("DELETE", `/api/v1/files/${encodeURIComponent(fileId)}`)).data;
  }
}

export class GravStorage {
  constructor({ baseUrl, apiKey, timeoutMs } = {}) {
    if (!baseUrl) throw new GravStorageError("GravStorage: baseUrl is required");
    if (!apiKey) throw new GravStorageError("GravStorage: apiKey is required");
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs || 0;
    this.files = new FilesApi(this);
  }
  _headers(extra) {
    return { authorization: `Bearer ${this.apiKey}`, ...(extra || {}) };
  }
  async _json(method, pathname, { body } = {}) {
    const res = await fetch(this.baseUrl + pathname, {
      method,
      headers: this._headers(body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const requestId = res.headers.get("x-request-id") || undefined;
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON */
    }
    if (!res.ok || !json?.success) {
      throw new GravStorageError(json?.error?.message || `Request failed (${res.status})`, { status: res.status, code: json?.error?.code, requestId });
    }
    return { data: json.data, requestId };
  }
  /** Project usage for this key (current storage, file count, quota, totals). */
  async usage() {
    return (await this._json("GET", "/api/v1/usage")).data;
  }
}

export default GravStorage;
