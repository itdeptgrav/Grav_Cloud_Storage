// scripts/test-storage-api.mjs
// A minimal Grav Storage API client / smoke test. Exercises the full happy
// path: upload → meta → HEAD → list → Range GET → download → delete.
//
// Usage (PowerShell):
//   $env:GRAV_STORAGE_URL="http://localhost:4000"
//   $env:GRAV_STORAGE_API_KEY="gsk_live_xxx"   # server-side secret — from env only
//   node scripts/test-storage-api.mjs [path-to-file]
//
// The API key is READ FROM THE ENVIRONMENT and never hardcoded or logged.

import fs from "fs";
import crypto from "crypto";

const URL_BASE = process.env.GRAV_STORAGE_URL;
const API_KEY = process.env.GRAV_STORAGE_API_KEY;
if (!URL_BASE || !API_KEY) {
  console.error("Set GRAV_STORAGE_URL and GRAV_STORAGE_API_KEY in the environment.");
  process.exit(1);
}
const authHeader = { Authorization: `Bearer ${API_KEY}` };
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

async function main() {
  // A sample file (or one you pass on the CLI).
  let bytes;
  let name;
  const arg = process.argv[2];
  if (arg) {
    bytes = fs.readFileSync(arg);
    name = arg.split(/[\\/]/).pop();
  } else {
    bytes = Buffer.from(`Grav Storage sample @ ${new Date().toISOString()}\n`.repeat(50));
    name = "sample.txt";
  }
  const sourceSha = sha(bytes);
  console.log(`Uploading ${name} (${bytes.length} bytes, sha256=${sourceSha.slice(0, 16)}…)`);

  // 1) Upload (multipart/form-data)
  const form = new FormData();
  form.append("file", new Blob([bytes]), name);
  const up = await fetch(`${URL_BASE}/api/v1/files`, { method: "POST", headers: authHeader, body: form });
  const upJson = await up.json();
  if (!upJson.success) throw new Error(`upload failed: ${JSON.stringify(upJson)}`);
  const fileId = upJson.data.fileId;
  console.log("→ uploaded:", { fileId, size: upJson.data.sizeBytes, mime: upJson.data.mimeType });
  console.log("  checksum match (source == stored):", upJson.data.checksumSha256 === sourceSha ? "PASS" : "FAIL");

  // 2) Metadata
  const meta = await (await fetch(`${URL_BASE}/api/v1/files/${fileId}/meta`, { headers: authHeader })).json();
  console.log("→ meta:", { name: meta.data.file.name, size: meta.data.file.sizeBytes, status: meta.data.file.status });

  // 3) HEAD
  const head = await fetch(`${URL_BASE}/api/v1/files/${fileId}`, { method: "HEAD", headers: authHeader });
  console.log("→ HEAD:", head.status, {
    length: head.headers.get("content-length"),
    type: head.headers.get("content-type"),
    ranges: head.headers.get("accept-ranges"),
  });

  // 4) List
  const list = await (await fetch(`${URL_BASE}/api/v1/files?limit=5`, { headers: authHeader })).json();
  console.log("→ list:", { total: list.data.total, returned: list.data.files.length });

  // 5) Range GET (first 16 bytes)
  const rangeRes = await fetch(`${URL_BASE}/api/v1/files/${fileId}`, { headers: { ...authHeader, Range: "bytes=0-15" } });
  const rangeBuf = Buffer.from(await rangeRes.arrayBuffer());
  console.log("→ Range GET:", rangeRes.status, "content-range:", rangeRes.headers.get("content-range"), "bytes:", rangeBuf.length);

  // 6) Full download + checksum round-trip
  const dl = await fetch(`${URL_BASE}/api/v1/files/${fileId}/download`, { headers: authHeader });
  const dlBuf = Buffer.from(await dl.arrayBuffer());
  const dlSha = sha(dlBuf);
  console.log("→ download:", dl.status, "bytes:", dlBuf.length, "checksum round-trip:", dlSha === sourceSha ? "PASS" : "FAIL");

  // 7) Delete (trash)
  const del = await (await fetch(`${URL_BASE}/api/v1/files/${fileId}`, { method: "DELETE", headers: authHeader })).json();
  console.log("→ delete:", del.success ? del.data.status : del.error);

  // 8) Read-after-delete → 404
  const after = await fetch(`${URL_BASE}/api/v1/files/${fileId}`, { headers: authHeader });
  console.log("→ read-after-delete:", after.status, "(expect 404)");

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
