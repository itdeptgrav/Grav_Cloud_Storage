// scripts/test-chunked-uploads.mjs
// Self-contained verification of the chunked upload system against an ISOLATED
// instance: its own mongod (temp dbpath), temp STORAGE_ROOT, its own Next build
// dir (NEXT_DIST_DIR=.next-chunktest) and port. It never touches the real
// database, the real storage directory or the dev server's .next (--prod only
// READS the production build there).
//
//   node --import ./scripts/alias-register.mjs scripts/test-chunked-uploads.mjs            # A20 suite
//   node --import ./scripts/alias-register.mjs scripts/test-chunked-uploads.mjs --matrix   # + B live matrix
//   … --matrix-only        only the B live matrix
//   … --short              matrix: 20 + 100 MiB only (B1/B6 on 100 MiB)
//   … --prod               run `next start` on the PRODUCTION build in .next
//                          (run `npm run build` first) instead of `next dev`
//   … --only <substring>   run only tests whose name contains it
//   … --serve              start the isolated instance with a throwaway login user
//                          (random password written to <work>/test-credentials.json,
//                          never printed) and keep it up for browser tests (B5)
//
// env: TEST_MONGOD_BIN (default: newest C:\Program Files\MongoDB\Server\*\bin\mongod.exe)
//      TEST_PORT (4100) · TEST_MONGO_PORT (27031) · TEST_WORK_DIR (os tmp) · TEST_KEEP=1 (keep temp dirs)
//
// Failures are provoked from the OUTSIDE — no fault hooks in production code:
//   storage error → temp file made read-only · rename error → Windows share-lock
//   Mongo error → temporary collection validator · connection reset → socket
//   destroyed mid-body · low disk → a real filler file vs MIN_FREE_DISK_BYTES.
// Every server log of the run is then scanned for absolute paths and for every
// secret the run used (JWT secret, pepper, API keys, session cookies).

import { spawn, spawnSync, execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

// ───────────────────────── config ─────────────────────────
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.TEST_PORT || 4100);
const MONGO_PORT = Number(process.env.TEST_MONGO_PORT || 27031);
const MATRIX_ONLY = process.argv.includes("--matrix-only");
const MATRIX = MATRIX_ONLY || process.argv.includes("--matrix");
const SERVE = process.argv.includes("--serve");
const SHORT = process.argv.includes("--short");
const PROD = process.argv.includes("--prod");
const ONLY = (() => { const i = process.argv.indexOf("--only"); return i > 0 ? process.argv[i + 1] : null; })();
const BASE = `http://localhost:${PORT}`;
const MiB = 1048576;
const WORK = await fsp.mkdtemp(path.join(process.env.TEST_WORK_DIR || os.tmpdir(), "gs-chunktest-"));
const STORAGE_ROOT = path.join(WORK, "storage", "data");
const CHUNK_DIR = path.join(WORK, "storage", "tmp", "chunked");
const MONGO_URI = `mongodb://127.0.0.1:${MONGO_PORT}/grav_chunktest`;
const JWT_SECRET = "chunktest-jwt-" + crypto.randomBytes(12).toString("hex");
const KEY_HASH_PEPPER = "chunktest-pepper-" + crypto.randomBytes(12).toString("hex");

function findMongod() {
  if (process.env.TEST_MONGOD_BIN) return process.env.TEST_MONGOD_BIN;
  const base = "C:\\Program Files\\MongoDB\\Server";
  const vers = fs.existsSync(base) ? fs.readdirSync(base).sort((a, b) => parseFloat(b) - parseFloat(a)) : [];
  for (const v of vers) {
    const p = path.join(base, v, "bin", "mongod.exe");
    if (fs.existsSync(p)) return p;
  }
  throw new Error("mongod not found — set TEST_MONGOD_BIN");
}

// ───────────────────────── results ─────────────────────────
const results = [];
const captured = []; // every JSON response body, checked for leaks at the end
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
async function test(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  try {
    record(name, true, (await fn()) || "");
  } catch (e) {
    record(name, false, e.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function expectErr(r, status, code) {
  assert(r.status === status && r.body?.error?.code === code, `expected ${status} ${code}, got ${r.status} ${r.body?.error?.code || (r.text || "").slice(0, 120)}`);
}
function expectOk(r, status = 200) {
  assert(r.status === status && r.body?.success, `expected ${status}, got ${r.status} ${r.body?.error?.code || ""} ${r.body?.error?.message || (r.text || "").slice(0, 120)}`);
  return r.body.data;
}

// ───────────────────────── processes ─────────────────────────
let mongoProc = null;
let serverProc = null;
let serverRun = 0;

function killTree(pid) {
  if (!pid) return;
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
}
async function waitTcp(port, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const okConn = await new Promise((res) => {
      const s = net.connect(port, "127.0.0.1");
      s.once("connect", () => { s.destroy(); res(true); });
      s.once("error", () => res(false));
    });
    if (okConn) return;
    await sleep(300);
  }
  throw new Error(`port ${port} did not open`);
}
async function startMongo() {
  const dbpath = path.join(WORK, "mongo");
  await fsp.mkdir(dbpath, { recursive: true });
  mongoProc = spawn(findMongod(), ["--dbpath", dbpath, "--port", String(MONGO_PORT), "--bind_ip", "127.0.0.1", "--quiet"], { stdio: "ignore" });
  await waitTcp(MONGO_PORT, 30000);
}
function serverEnv(extra = {}) {
  const env = {
    ...process.env,
    NODE_ENV: PROD ? "production" : "development",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_DIST_DIR: ".next-chunktest",
    // The real .env's bootstrap admin must never be seeded into a test instance
    // (Next loads .env only for variables that are still undefined).
    BOOTSTRAP_ADMIN_EMAIL: "",
    BOOTSTRAP_ADMIN_PASSWORD: "",
    BOOTSTRAP_ADMIN_RESET: "",
    PORT: String(PORT),
    MONGODB_URI: MONGO_URI,
    STORAGE_ROOT,
    JWT_SECRET,
    KEY_HASH_PEPPER,
    MAX_UPLOAD_SIZE_BYTES: String(8 * 1024 * MiB),
    MAX_CONCURRENT_UPLOADS_PER_PROJECT: "3",
    MIN_FREE_DISK_BYTES: "0",
    CHUNK_SESSION_IDLE_TTL_MINUTES: "360",
    API_RATE_LIMIT_REQUESTS: "100000",
    ...extra,
  };
  if (PROD) delete env.NEXT_DIST_DIR; // `next start` serves the real build in .next
  return env;
}
// `next dev` has been seen (2 of 6 starts in one suite run, 1 of 8 in an idle
// probe) to come up WITHOUT the dashboard chunk route in its route table: every
// request to it got Next's HTML 404 page ("Compiling /_not-found/page") for the
// life of that server, while the same code on the next start served it. A
// dev-server route-discovery race (a `next build` + `next start` production
// server served it on 8 of 8 starts), not an upload failure — so a start whose
// warmup routes are not all answered by their handlers (JSON) is restarted, and
// counted in the summary.
const devRouteRestarts = [];
async function startServer(extra = {}, label = "") {
  for (let attempt = 1; ; attempt++) {
    const logFile = await launchServer(extra, label);
    // Compile the routes we use before timing anything — and check they exist.
    const warm = [
      await call("GET", "/api/v1/files/chunk?op=list", { key: K.k1 }),
      await call("GET", `/api/dashboard/projects/${P.p1}/files/chunk?op=list`, { cookie: C.a }),
      await call("GET", "/api/v1/files?limit=1", { key: K.k1 }),
      await call("GET", "/api/v1/files/file_warmup0000000000000000", { key: K.k1 }),
    ];
    const missing = warm.map((r, i) => (r.body ? null : `warmup #${i + 1} → ${r.status} non-JSON`)).filter(Boolean);
    if (!missing.length) return logFile;
    devRouteRestarts.push({ server: path.basename(logFile), missing });
    console.log(`NOTE  server ${path.basename(logFile)} started without a route (${missing.join("; ")}) — restarting it`);
    if (attempt >= 3) throw new Error(`server kept starting without its routes (see ${logFile})`);
    await stopServer();
  }
}
async function launchServer(extra, label) {
  serverRun++;
  const logFile = path.join(WORK, `server-${serverRun}${label ? "-" + label : ""}.log`);
  const fd = fs.openSync(logFile, "a");
  serverProc = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), PROD ? "start" : "dev", "-p", String(PORT)], {
    cwd: ROOT,
    env: serverEnv(extra),
    stdio: ["ignore", fd, fd],
  });
  const until = Date.now() + 240000;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      const j = await r.json().catch(() => null);
      if (r.status === 200 && j?.checks?.database === "up") break;
    } catch {
      /* not up yet */
    }
    await sleep(800);
  }
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (h?.checks?.database !== "up") throw new Error(`server did not become healthy (see ${logFile})`);
  return logFile;
}
async function stopServer() {
  if (!serverProc) return;
  killTree(serverProc.pid);
  serverProc = null;
  for (let i = 0; i < 50; i++) {
    const up = await new Promise((res) => {
      const s = net.connect(PORT, "127.0.0.1");
      s.once("connect", () => { s.destroy(); res(true); });
      s.once("error", () => res(false));
    });
    if (!up) return;
    await sleep(200);
  }
}

// ───────────────────────── app handles (after env is set) ─────────────────────────
Object.assign(process.env, { MONGODB_URI: MONGO_URI, STORAGE_ROOT, JWT_SECRET, KEY_HASH_PEPPER });
const M = {};
const P = {}; // project ids
const K = {}; // api keys (raw, test-only)
const C = {}; // session cookies (test-only)
const U = {}; // users

async function loadApp() {
  M.mongoose = (await import("mongoose")).default;
  // This process must not build collections/indexes itself — the index test
  // proves that the SERVER creates them on first use (no migration step).
  M.mongoose.set("autoIndex", false);
  M.mongoose.set("autoCreate", false);
  M.connectDB = (await import("@/lib/db/mongoose")).connectDB;
  M.User = (await import("@/lib/db/models/User")).default;
  M.Project = (await import("@/lib/db/models/Project")).default;
  M.FileObject = (await import("@/lib/db/models/FileObject")).default;
  M.UploadSession = (await import("@/lib/db/models/UploadSession")).default;
  M.apiKeys = await import("@/lib/services/apiKeyService");
  M.maintenance = await import("@/lib/maintenance");
  M.Sha256 = (await import("@/lib/sha256")).Sha256;
  M.SignJWT = (await import("jose")).SignJWT;
  await M.connectDB();
}
async function cookieFor(user, { expired = false } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const t = await new M.SignJWT({ role: user.role, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user._id))
    .setIssuedAt(expired ? now - 7200 : now)
    .setExpirationTime(expired ? now - 3600 : now + 7200)
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `gs_session=${t}`;
}
async function seed() {
  const mk = (name, email, role) => M.User.create({ name, email, passwordHash: "x", role, status: "active" });
  U.a = await mk("Owner A", "owner-a@chunktest.local", "user");
  U.b = await mk("User B", "user-b@chunktest.local", "user");
  U.s = await mk("Admin S", "admin-s@chunktest.local", "superadmin");
  const p1 = await M.Project.create({ ownerId: U.a._id, name: "P1", status: "active", quotaBytes: null });
  const p2 = await M.Project.create({ ownerId: U.b._id, name: "P2", status: "active", quotaBytes: null });
  P.p1 = String(p1._id);
  P.p2 = String(p2._id);
  const scopes = M.apiKeys.VALID_SCOPES;
  K.k1 = (await M.apiKeys.createApiKey(p1, { name: "k1", scopes })).rawKey;
  K.k1b = (await M.apiKeys.createApiKey(p1, { name: "k1b", scopes })).rawKey;
  K.k2 = (await M.apiKeys.createApiKey(p2, { name: "k2", scopes })).rawKey;
  C.a = await cookieFor(U.a);
  C.b = await cookieFor(U.b);
  C.s = await cookieFor(U.s);
  C.aExpired = await cookieFor(U.a, { expired: true });
}

// ───────────────────────── http ─────────────────────────
async function call(method, pathQ, { key, cookie, json, body, headers = {}, origin } = {}) {
  const h = { ...headers };
  if (key) h.Authorization = `Bearer ${key}`;
  if (cookie) {
    h.Cookie = cookie;
    if (method !== "GET") h.Origin = origin || BASE; // a browser always sends Origin on POST
  }
  let payload = body;
  if (json !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(json);
  }
  const res = await fetch(BASE + pathQ, { method, headers: h, body: payload });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (parsed) captured.push(text);
  return { status: res.status, body: parsed, text };
}
const apiPlane = (key) => ({ base: "/api/v1/files/chunk", auth: { key } });
const dashPlane = (projectId, cookie) => ({ base: `/api/dashboard/projects/${projectId}/files/chunk`, auth: { cookie } });
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const manifest = (hashes) => sha256(Buffer.from(hashes.join(""), "ascii"));
const begin = (pl, payload) => call("POST", `${pl.base}?op=begin`, { ...pl.auth, json: payload });
const append = (pl, id, i, buf, sha = sha256(buf), extra = {}) =>
  call("POST", `${pl.base}?op=append&uploadId=${id}&index=${i}`, { ...pl.auth, body: buf, headers: { "Content-Type": "application/octet-stream", "x-chunk-sha256": sha, ...extra } });
const status = (pl, id) => call("GET", `${pl.base}?op=status&uploadId=${id}`, pl.auth);
const complete = (pl, id, payload) => call("POST", `${pl.base}?op=complete&uploadId=${id}`, { ...pl.auth, json: payload });
const abort = (pl, id) => call("POST", `${pl.base}?op=abort&uploadId=${id}`, { ...pl.auth, json: {} });

// Append that tolerates a still-draining earlier attempt (CHUNK_IN_PROGRESS).
async function appendSettled(pl, id, i, buf, sha) {
  for (let t = 0; t < 40; t++) {
    const r = await append(pl, id, i, buf, sha);
    if (r.body?.error?.code !== "CHUNK_IN_PROGRESS") return r;
    await sleep(250);
  }
  throw new Error("chunk stayed IN_PROGRESS");
}

// A real mid-body disconnect: send part of the chunk, then destroy the socket.
function appendInterrupted(pl, id, i, buf, sha, fraction = 0.5) {
  return new Promise((resolve) => {
    const u = new URL(`${BASE}${pl.base}?op=append&uploadId=${id}&index=${i}`);
    const headers = { "Content-Type": "application/octet-stream", "x-chunk-sha256": sha, "Content-Length": buf.length };
    if (pl.auth.key) headers.Authorization = `Bearer ${pl.auth.key}`;
    if (pl.auth.cookie) Object.assign(headers, { Cookie: pl.auth.cookie, Origin: BASE });
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", headers });
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    req.on("error", () => done("reset"));
    req.on("response", (res) => { res.resume(); done(`responded ${res.statusCode}`); });
    req.write(buf.subarray(0, Math.floor(buf.length * fraction)), () => setTimeout(() => { req.destroy(); done("reset"); }, 150));
  });
}

// ───────────────────────── data ─────────────────────────
function detBuffer(size, seed) {
  const key = crypto.createHash("sha256").update("k" + seed).digest().subarray(0, 16);
  const iv = crypto.createHash("sha256").update("iv" + seed).digest().subarray(0, 16);
  return crypto.createCipheriv("aes-128-ctr", key, iv).update(Buffer.alloc(size));
}
async function writeDetFile(file, size, seed) {
  const key = crypto.createHash("sha256").update("k" + seed).digest().subarray(0, 16);
  const iv = crypto.createHash("sha256").update("iv" + seed).digest().subarray(0, 16);
  const c = crypto.createCipheriv("aes-128-ctr", key, iv);
  const h = crypto.createHash("sha256");
  const fh = await fsp.open(file, "w");
  const zeros = Buffer.alloc(4 * MiB);
  let left = size;
  while (left > 0) {
    const n = Math.min(left, zeros.length);
    const b = c.update(zeros.subarray(0, n));
    h.update(b);
    await fh.write(b);
    left -= n;
  }
  await fh.close();
  return h.digest("hex");
}
function bufSource(buf) {
  return { size: buf.length, read: async (s, e) => buf.subarray(s, e), close: async () => {} };
}
async function fileSource(file) {
  const fh = await fsp.open(file, "r");
  const size = (await fh.stat()).size;
  return {
    size,
    async read(s, e) {
      const b = Buffer.allocUnsafe(e - s);
      let off = 0;
      while (off < b.length) {
        const { bytesRead } = await fh.read(b, off, b.length - off, s + off);
        if (!bytesRead) throw new Error("short read");
        off += bytesRead;
      }
      return b;
    },
    close: () => fh.close(),
  };
}
async function chunkHashesOf(src, chunkSize) {
  const out = [];
  for (let s = 0; s < src.size; s += chunkSize) out.push(sha256(await src.read(s, Math.min(s + chunkSize, src.size))));
  return out;
}
// Sends chunks [from, to) and returns their hashes (computed while sending, as the real client does).
async function sendRange(pl, id, src, chunkSize, from, to) {
  const hashes = [];
  for (let i = from; i < to; i++) {
    const buf = await src.read(i * chunkSize, Math.min((i + 1) * chunkSize, src.size));
    const h = sha256(buf);
    hashes.push(h);
    const r = await appendSettled(pl, id, i, buf, h);
    assert(r.status === 200 && r.body?.data?.accepted, `chunk ${i}: ${r.status} ${r.body?.error?.code}`);
  }
  return hashes;
}
async function fullUpload(pl, src, name, { chunkSize, beginExtra = {} } = {}) {
  const s = expectOk(await begin(pl, { filename: name, size: src.size, mimeType: "application/octet-stream", ...(chunkSize ? { chunkSize } : {}), ...beginExtra }), 201);
  await sendRange(pl, s.uploadId, src, s.chunkSize, 0, s.totalChunks);
  const hashes = await chunkHashesOf(src, s.chunkSize);
  return { session: s, hashes, done: await complete(pl, s.uploadId, { manifestSha256: manifest(hashes) }) };
}
async function downloadSha(key, fileId) {
  const res = await fetch(`${BASE}/api/v1/files/${fileId}`, { headers: { Authorization: `Bearer ${key}` } });
  assert(res.status === 200, `download ${fileId}: ${res.status}`);
  const h = crypto.createHash("sha256");
  let bytes = 0;
  for await (const chunk of res.body) {
    h.update(chunk);
    bytes += chunk.length;
  }
  return { sha: h.digest("hex"), bytes };
}
const sessionDoc = (uploadId) => M.UploadSession.findOne({ uploadId }).lean();
const tempPathOf = (tmpObjId) => path.join(CHUNK_DIR, `${tmpObjId}.part`);
async function counters(pid) {
  const p = await M.Project.findById(pid).lean();
  return { bytes: p.currentStorageBytes, files: p.fileCount, docs: await M.FileObject.countDocuments({ projectId: pid, status: "active" }) };
}
function dataObjectCount() {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else n++;
    }
  };
  walk(STORAGE_ROOT);
  return n;
}
async function abortAllActive(pl, projectId) {
  const rows = await M.UploadSession.find({ projectId, status: "active" }).lean();
  for (const r of rows) {
    const plane = r.plane === "api" ? pl.api : pl.dash;
    await abort(plane, r.uploadId);
  }
}

// ───────────────────────── server RSS (Windows) ─────────────────────────
function pidOnPort(port) {
  const out = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" }).stdout || "";
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols[1]?.endsWith(`:${port}`) && cols[3] === "LISTENING") return Number(cols[4]);
  }
  return null;
}
function rssMB(pid) {
  return new Promise((res) => {
    execFile("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], (e, out) => {
      const m = /"([\d,.]+) K"/.exec(out || "");
      res(m ? Number(m[1].replace(/[^\d]/g, "")) / 1024 : null);
    });
  });
}
function rssSampler(pid) {
  let peak = 0;
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      const v = await rssMB(pid);
      if (v && v > peak) peak = v;
      await sleep(700);
    }
  })();
  return { async end() { stop = true; await loop; return peak; } };
}

// ═════════════════════════ A20 — core suite ═════════════════════════
async function suiteCore() {
  const api = apiPlane(K.k1);
  const dash = dashPlane(P.p1, C.a);
  const planes = { api, dash };
  const small = detBuffer(3.5 * MiB, "small"); // 4 chunks at 1 MiB
  const src = bufSource(small);
  const SRC_SHA = sha256(small);

  await test("A20 JS SHA-256 fallback matches Node crypto (incl. state export/import)", async () => {
    let checks = 0;
    for (let n = 0; n <= 200; n++) {
      const b = crypto.randomBytes(n);
      assert(new M.Sha256().update(b).hex() === sha256(b), `len ${n}`);
      checks++;
    }
    for (let t = 0; t < 60; t++) {
      const b = crypto.randomBytes(Math.floor(Math.random() * 200000));
      let h = new M.Sha256();
      for (let p = 0; p < b.length; ) {
        const k = Math.min(b.length - p, 1 + Math.floor(Math.random() * 50000));
        h.update(b.subarray(p, p + k));
        p += k;
        h = new M.Sha256(JSON.parse(JSON.stringify(h.exportState())));
      }
      assert(h.hex() === sha256(b), "random split");
      checks++;
    }
    return `${checks} vectors`;
  });

  await test("A20 begin — validation", async () => {
    expectErr(await begin(api, { filename: "x", size: 0 }), 400, "VALIDATION_ERROR");
    expectErr(await begin(api, { filename: "x", size: 10 * MiB, chunkSize: 100 * MiB }), 400, "VALIDATION_ERROR");
    expectErr(await begin(api, { filename: "x", size: 10 * MiB, chunkSize: 512 * 1024 }), 400, "VALIDATION_ERROR");
    expectErr(await begin(api, { filename: "", size: 10 }), 400, "VALIDATION_ERROR");
    const s = expectOk(await begin(api, { filename: "v.bin", size: src.size, chunkSize: MiB }), 201);
    assert(s.totalChunks === 4 && s.nextIndex === 0 && s.chunkSize === MiB, "session shape");
    assert(!("tmpObjId" in s) && !JSON.stringify(s).includes(".part"), "temp id leaked");
    const def = expectOk(await begin(api, { filename: "d.bin", size: 900 * MiB }), 201);
    assert(def.chunkSize === 80 * MiB && def.totalChunks === 12, `default chunk size ${def.chunkSize}`);
    await abort(api, s.uploadId);
    await abort(api, def.uploadId);
    return "bad size/chunkSize/filename rejected; default 80 MiB";
  });

  await test("A20 finalize success (API plane) — stored & downloaded SHA = source", async () => {
    const before = await counters(P.p1);
    const { session, done } = await fullUpload(api, src, "api-ok.bin", { chunkSize: MiB });
    const d = expectOk(done, 201);
    assert(d.file.checksumSha256 === SRC_SHA && d.file.sizeBytes === src.size, "stored checksum/size");
    const dl = await downloadSha(K.k1, d.fileId);
    assert(dl.sha === SRC_SHA && dl.bytes === src.size, "download sha");
    const doc = await sessionDoc(session.uploadId);
    assert(doc.status === "completed" && doc.fileId === d.fileId, "session completed");
    assert(!fs.existsSync(tempPathOf(doc.tmpObjId)), "temp promoted (gone from tmp)");
    const again = expectOk(await complete(api, session.uploadId, { manifestSha256: "0".repeat(64) }), 200);
    assert(again.alreadyCompleted && again.fileId === d.fileId, "complete is idempotent");
    const after = await counters(P.p1);
    assert(after.bytes === before.bytes + src.size && after.files === before.files + 1, "counters +1 file");
    return `fileId ${d.fileId}, sha ${SRC_SHA.slice(0, 12)}…`;
  });

  await test("A20 finalize success (dashboard plane, session auth + CSRF)", async () => {
    const { done } = await fullUpload(dash, src, "dash-ok.bin", { chunkSize: MiB });
    const d = expectOk(done, 201);
    assert(d.file.checksumSha256 === SRC_SHA, "stored sha");
    assert(/Dashboard/.test(d.file.uploadedByLabel), `uploader label ${d.file.uploadedByLabel}`);
    return d.file.uploadedByLabel;
  });

  await test("A20 both routes — begin, append, status/resume, complete, abort", async () => {
    for (const [name, pl] of Object.entries(planes)) {
      // begin → 2 of 4 chunks → status says resume at 2 → the rest → complete.
      const s = expectOk(await begin(pl, { filename: `ops-${name}.bin`, size: src.size, chunkSize: MiB }), 201);
      await sendRange(pl, s.uploadId, src, MiB, 0, 2);
      const st = expectOk(await status(pl, s.uploadId));
      assert(st.status === "active" && st.nextIndex === 2 && st.bytesReceived === 2 * MiB && st.chunkHashes.length === 2, `${name}: status`);
      await sendRange(pl, s.uploadId, src, MiB, st.nextIndex, s.totalChunks);
      const d = expectOk(await complete(pl, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, MiB)) }), 201);
      assert(d.file.sizeBytes === src.size && d.file.checksumSha256 === SRC_SHA, `${name}: stored file`);
      // begin → 1 chunk → abort: closed for good, temp file removed.
      const a = expectOk(await begin(pl, { filename: `abort-${name}.bin`, size: src.size, chunkSize: MiB }), 201);
      await sendRange(pl, a.uploadId, src, MiB, 0, 1);
      const tmp = (await sessionDoc(a.uploadId)).tmpObjId;
      assert(expectOk(await abort(pl, a.uploadId)).aborted === true, `${name}: abort`);
      expectErr(await append(pl, a.uploadId, 1, await src.read(MiB, 2 * MiB)), 409, "UPLOAD_SESSION_CLOSED");
      assert(!fs.existsSync(tempPathOf(tmp)), `${name}: temp removed`);
    }
    return "API + dashboard: begin → append → status (resume at 2/4) → complete 201; begin → abort → closed, temp removed";
  });

  await test("Mongo — upload_sessions indexes created by the server (no migration)", async () => {
    const idx = await M.UploadSession.collection.indexes();
    const find = (key) => idx.find((i) => JSON.stringify(i.key) === JSON.stringify(key));
    assert(find({ uploadId: 1 })?.unique === true, "uploadId unique");
    assert(find({ purgeAt: 1 })?.expireAfterSeconds === 0, "purgeAt TTL");
    assert(find({ projectId: 1, status: 1 }), "projectId+status");
    return idx.map((i) => i.name).join(", ");
  });

  await test("A20 wrong index → BAD_CHUNK_INDEX (session unchanged)", async () => {
    const s = expectOk(await begin(api, { filename: "idx.bin", size: src.size, chunkSize: MiB }), 201);
    const c2 = await src.read(2 * MiB, 3 * MiB);
    const r = await append(api, s.uploadId, 2, c2);
    expectErr(r, 409, "BAD_CHUNK_INDEX");
    assert(r.body.error.details?.expected === 0, "details.expected");
    expectErr(await append(api, s.uploadId, 9, c2), 409, "BAD_CHUNK_INDEX");
    const st = expectOk(await status(api, s.uploadId));
    assert(st.nextIndex === 0 && st.bytesReceived === 0, "unchanged");
    await abort(api, s.uploadId);
  });

  await test("A20 duplicate chunk → alreadyAccepted, never appended twice", async () => {
    const s = expectOk(await begin(api, { filename: "dup.bin", size: src.size, chunkSize: MiB }), 201);
    const c0 = await src.read(0, MiB);
    expectOk(await append(api, s.uploadId, 0, c0));
    const dup = expectOk(await append(api, s.uploadId, 0, c0));
    assert(dup.alreadyAccepted === true && dup.bytesReceived === MiB, "ack only");
    const doc = await sessionDoc(s.uploadId);
    assert(fs.statSync(tempPathOf(doc.tmpObjId)).size === MiB, "temp size unchanged");
    await sendRange(api, s.uploadId, src, MiB, 1, 4);
    const d = expectOk(await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, MiB)) }), 201);
    assert(d.file.checksumSha256 === SRC_SHA, "final sha exact");
  });

  await test("A20 conflicting duplicate → CHUNK_CONFLICT", async () => {
    const s = expectOk(await begin(api, { filename: "cf.bin", size: src.size, chunkSize: MiB }), 201);
    expectOk(await append(api, s.uploadId, 0, await src.read(0, MiB)));
    const other = detBuffer(MiB, "other");
    expectErr(await append(api, s.uploadId, 0, other), 409, "CHUNK_CONFLICT");
    await abort(api, s.uploadId);
  });

  await test("A20 chunk checksum fail → rejected, retry same chunk succeeds", async () => {
    const s = expectOk(await begin(api, { filename: "ck.bin", size: src.size, chunkSize: MiB }), 201);
    expectOk(await append(api, s.uploadId, 0, await src.read(0, MiB)));
    const c1 = await src.read(MiB, 2 * MiB);
    expectErr(await append(api, s.uploadId, 1, c1, "f".repeat(64)), 422, "CHUNK_CHECKSUM_MISMATCH");
    const st = expectOk(await status(api, s.uploadId));
    const doc = await sessionDoc(s.uploadId);
    assert(st.nextIndex === 1 && fs.statSync(tempPathOf(doc.tmpObjId)).size === MiB, "cut back to chunk 0");
    expectOk(await append(api, s.uploadId, 1, c1));
    await sendRange(api, s.uploadId, src, MiB, 2, 4);
    expectOk(await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, MiB)) }), 201);
  });

  await test("A20 missing checksum header / wrong length rejected", async () => {
    const s = expectOk(await begin(api, { filename: "hdr.bin", size: src.size, chunkSize: MiB }), 201);
    const c0 = await src.read(0, MiB);
    const noHdr = await call("POST", `${api.base}?op=append&uploadId=${s.uploadId}&index=0`, { key: K.k1, body: c0, headers: { "Content-Type": "application/octet-stream" } });
    expectErr(noHdr, 400, "VALIDATION_ERROR");
    const short = c0.subarray(0, MiB - 10);
    expectErr(await append(api, s.uploadId, 0, short), 400, "CHUNK_SIZE_MISMATCH");
    const st = expectOk(await status(api, s.uploadId));
    assert(st.nextIndex === 0, "unchanged");
    await abort(api, s.uploadId);
  });

  await test("A20 retry after connection reset mid-chunk", async () => {
    const s = expectOk(await begin(api, { filename: "reset.bin", size: src.size, chunkSize: MiB }), 201);
    expectOk(await append(api, s.uploadId, 0, await src.read(0, MiB)));
    const c1 = await src.read(MiB, 2 * MiB);
    const how = await appendInterrupted(api, s.uploadId, 1, c1, sha256(c1), 0.5);
    await sleep(400);
    const st = expectOk(await status(api, s.uploadId));
    assert(st.nextIndex === 1 && st.bytesReceived === MiB, "progress preserved");
    expectOk(await appendSettled(api, s.uploadId, 1, c1, sha256(c1)));
    await sendRange(api, s.uploadId, src, MiB, 2, 4);
    const d = expectOk(await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, MiB)) }), 201);
    assert(d.file.checksumSha256 === SRC_SHA, "sha exact");
    return `interruption: ${how}`;
  });

  await test("A20 retry after storage failure (temp read-only → 503, then OK)", async () => {
    const s = expectOk(await begin(api, { filename: "io.bin", size: src.size, chunkSize: MiB }), 201);
    expectOk(await append(api, s.uploadId, 0, await src.read(0, MiB)));
    const doc = await sessionDoc(s.uploadId);
    const tp = tempPathOf(doc.tmpObjId);
    fs.chmodSync(tp, 0o444);
    const c1 = await src.read(MiB, 2 * MiB);
    let r;
    try {
      r = await append(api, s.uploadId, 1, c1);
    } finally {
      fs.chmodSync(tp, 0o666);
    }
    expectErr(r, 503, "STORAGE_UNAVAILABLE");
    const st = expectOk(await status(api, s.uploadId));
    assert(st.nextIndex === 1, "prior chunk preserved");
    expectOk(await append(api, s.uploadId, 1, c1));
    await sendRange(api, s.uploadId, src, MiB, 2, 4);
    expectOk(await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, MiB)) }), 201);
  });

  await test("A20 complete before all chunks → SIZE_MISMATCH, session stays live", async () => {
    const s = expectOk(await begin(api, { filename: "early.bin", size: src.size, chunkSize: MiB }), 201);
    await sendRange(api, s.uploadId, src, MiB, 0, 2);
    const r = await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, MiB)) });
    expectErr(r, 422, "SIZE_MISMATCH");
    assert(r.body.error.details?.nextIndex === 2, "details");
    await sendRange(api, s.uploadId, src, MiB, 2, 4);
    expectOk(await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, MiB)) }), 201);
  });

  await test("A20 finalize checksum mismatch → nothing stored, temp cleaned, counters unchanged", async () => {
    const before = await counters(P.p1);
    const s = expectOk(await begin(api, { filename: "bad.bin", size: src.size, chunkSize: MiB }), 201);
    await sendRange(api, s.uploadId, src, MiB, 0, 4);
    const doc = await sessionDoc(s.uploadId);
    expectErr(await complete(api, s.uploadId, { manifestSha256: "a".repeat(64) }), 422, "CHECKSUM_MISMATCH");
    const after = await counters(P.p1);
    const d2 = await sessionDoc(s.uploadId);
    assert(d2.status === "failed" && d2.failureCode === "CHECKSUM_MISMATCH", "session failed");
    assert(!fs.existsSync(tempPathOf(doc.tmpObjId)), "temp removed");
    assert(after.bytes === before.bytes && after.files === before.files && after.docs === before.docs, "no counter drift");
    expectErr(await append(api, s.uploadId, 0, await src.read(0, MiB)), 409, "UPLOAD_SESSION_CLOSED");
  });

  await test("A20 full-file SHA (API clients) enforced at complete", async () => {
    const wrong = expectOk(await begin(api, { filename: "fs.bin", size: src.size, chunkSize: MiB, sha256: "b".repeat(64) }), 201);
    await sendRange(api, wrong.uploadId, src, MiB, 0, 4);
    expectErr(await complete(api, wrong.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, MiB)) }), 422, "CHECKSUM_MISMATCH");
    const { done } = await fullUpload(api, src, "fs-ok.bin", { chunkSize: MiB, beginExtra: { sha256: SRC_SHA } });
    expectOk(done, 201);
  });

  await test("A20 abort → temp deleted, session closed", async () => {
    const s = expectOk(await begin(api, { filename: "ab.bin", size: src.size, chunkSize: MiB }), 201);
    expectOk(await append(api, s.uploadId, 0, await src.read(0, MiB)));
    const doc = await sessionDoc(s.uploadId);
    const r = expectOk(await abort(api, s.uploadId));
    assert(r.aborted && (await sessionDoc(s.uploadId)).status === "aborted", "aborted");
    assert(!fs.existsSync(tempPathOf(doc.tmpObjId)), "temp removed");
    expectErr(await append(api, s.uploadId, 1, await src.read(MiB, 2 * MiB)), 409, "UPLOAD_SESSION_CLOSED");
    expectOk(await abort(api, s.uploadId)); // idempotent
  });

  await test("A20 expired session → UPLOAD_SESSION_EXPIRED, temp removed", async () => {
    const s = expectOk(await begin(api, { filename: "exp.bin", size: src.size, chunkSize: MiB }), 201);
    expectOk(await append(api, s.uploadId, 0, await src.read(0, MiB)));
    const doc = await sessionDoc(s.uploadId);
    await M.UploadSession.updateOne({ uploadId: s.uploadId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expectErr(await append(api, s.uploadId, 1, await src.read(MiB, 2 * MiB)), 410, "UPLOAD_SESSION_EXPIRED");
    assert((await sessionDoc(s.uploadId)).status === "expired", "status expired");
    assert(!fs.existsSync(tempPathOf(doc.tmpObjId)), "temp removed");
  });

  await test("A20 cross-user access → forbidden (incl. superadmin, other key, other plane)", async () => {
    const s = expectOk(await begin(dash, { filename: "own.bin", size: src.size, chunkSize: MiB }), 201);
    const c0 = await src.read(0, MiB);
    expectErr(await append(dashPlane(P.p1, C.s), s.uploadId, 0, c0), 403, "UPLOAD_SESSION_FORBIDDEN"); // superadmin
    const other = await append(dashPlane(P.p1, C.b), s.uploadId, 0, c0); // user B has no access to P1
    assert(other.status === 404 && other.body?.error?.code === "NOT_FOUND", `user B: ${other.status} ${other.body?.error?.code}`);
    expectErr(await append(apiPlane(K.k1), s.uploadId, 0, c0), 403, "UPLOAD_SESSION_FORBIDDEN"); // same project, API plane
    expectErr(await complete(dashPlane(P.p1, C.s), s.uploadId, { manifestSha256: "0".repeat(64) }), 403, "UPLOAD_SESSION_FORBIDDEN");
    const a = expectOk(await begin(api, { filename: "k.bin", size: src.size, chunkSize: MiB }), 201);
    expectErr(await append(apiPlane(K.k1b), a.uploadId, 0, c0), 403, "UPLOAD_SESSION_FORBIDDEN"); // another key, same project
    expectErr(await status(apiPlane(K.k1b), a.uploadId), 403, "UPLOAD_SESSION_FORBIDDEN");
    const st = expectOk(await status(dash, s.uploadId));
    assert(st.nextIndex === 0, "owner's session untouched");
    await abort(dash, s.uploadId);
    await abort(api, a.uploadId);
  });

  await test("A20 cross-project access → forbidden", async () => {
    const s = expectOk(await begin(api, { filename: "xp.bin", size: src.size, chunkSize: MiB }), 201);
    expectErr(await append(apiPlane(K.k2), s.uploadId, 0, await src.read(0, MiB)), 403, "UPLOAD_SESSION_FORBIDDEN");
    expectErr(await complete(apiPlane(K.k2), s.uploadId, { manifestSha256: "0".repeat(64) }), 403, "UPLOAD_SESSION_FORBIDDEN");
    expectErr(await abort(apiPlane(K.k2), s.uploadId), 403, "UPLOAD_SESSION_FORBIDDEN");
    await abort(api, s.uploadId);
  });

  await test("A20 CSRF — cross-origin dashboard POST blocked", async () => {
    const r = await call("POST", `${dash.base}?op=begin`, { cookie: C.a, origin: "http://evil.example", json: { filename: "c.bin", size: 100 } });
    expectErr(r, 403, "CSRF_FAILED");
  });

  await test("A20 project disabled mid-upload → PROJECT_DISABLED (both planes), resumes after re-enable", async () => {
    const s = expectOk(await begin(api, { filename: "dis.bin", size: src.size, chunkSize: MiB }), 201);
    const sd = expectOk(await begin(dash, { filename: "dis-d.bin", size: src.size, chunkSize: MiB }), 201);
    await sendRange(api, s.uploadId, src, MiB, 0, 2);
    await M.Project.updateOne({ _id: P.p1 }, { $set: { status: "disabled" } });
    try {
      expectErr(await append(api, s.uploadId, 2, await src.read(2 * MiB, 3 * MiB)), 403, "PROJECT_DISABLED");
      expectErr(await append(dash, sd.uploadId, 0, await src.read(0, MiB)), 403, "PROJECT_DISABLED");
      expectErr(await complete(dash, sd.uploadId, { manifestSha256: "0".repeat(64) }), 403, "PROJECT_DISABLED");
      expectErr(await status(dash, sd.uploadId), 403, "PROJECT_DISABLED");
      const doc = await sessionDoc(s.uploadId);
      assert(doc.status === "active" && fs.statSync(tempPathOf(doc.tmpObjId)).size === 2 * MiB, "temp + progress preserved");
    } finally {
      await M.Project.updateOne({ _id: P.p1 }, { $set: { status: "active" } });
    }
    await sendRange(api, s.uploadId, src, MiB, 2, 4);
    expectOk(await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, MiB)) }), 201);
    await abort(dash, sd.uploadId);
    return "policy: session + temp kept while disabled; continues after re-enable (until idle expiry)";
  });

  await test("A20 quota — begin refused; lowered mid-upload → refused but resumable", async () => {
    const c = await counters(P.p1);
    await M.Project.updateOne({ _id: P.p1 }, { $set: { quotaBytes: c.bytes + MiB } });
    expectErr(await begin(api, { filename: "q.bin", size: src.size, chunkSize: MiB }), 507, "STORAGE_QUOTA_EXCEEDED");
    await M.Project.updateOne({ _id: P.p1 }, { $set: { quotaBytes: null } });
    const s = expectOk(await begin(api, { filename: "q.bin", size: src.size, chunkSize: MiB }), 201);
    await sendRange(api, s.uploadId, src, MiB, 0, 2);
    await M.Project.updateOne({ _id: P.p1 }, { $set: { quotaBytes: c.bytes + MiB } });
    expectErr(await append(api, s.uploadId, 2, await src.read(2 * MiB, 3 * MiB)), 507, "STORAGE_QUOTA_EXCEEDED");
    expectErr(await complete(api, s.uploadId, { manifestSha256: "0".repeat(64) }), 422, "SIZE_MISMATCH");
    await M.Project.updateOne({ _id: P.p1 }, { $set: { quotaBytes: null } });
    await sendRange(api, s.uploadId, src, MiB, 2, 4);
    expectOk(await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, MiB)) }), 201);
  });

  await test("A20 quota race — two uploads, room for one: exactly one commits", async () => {
    const before = await counters(P.p1);
    await M.Project.updateOne({ _id: P.p1 }, { $set: { quotaBytes: before.bytes + Math.floor(src.size * 1.5) } });
    try {
      const s1 = expectOk(await begin(api, { filename: "r1.bin", size: src.size, chunkSize: MiB }), 201);
      const s2 = expectOk(await begin(api, { filename: "r2.bin", size: src.size, chunkSize: MiB }), 201);
      await Promise.all([sendRange(api, s1.uploadId, src, MiB, 0, 4), sendRange(api, s2.uploadId, src, MiB, 0, 4)]);
      const m = manifest(await chunkHashesOf(src, MiB));
      const [r1, r2] = await Promise.all([complete(api, s1.uploadId, { manifestSha256: m }), complete(api, s2.uploadId, { manifestSha256: m })]);
      const oks = [r1, r2].filter((r) => r.status === 201).length;
      const quota = [r1, r2].filter((r) => r.body?.error?.code === "STORAGE_QUOTA_EXCEEDED").length;
      assert(oks === 1 && quota === 1, `results ${r1.status}/${r1.body?.error?.code} ${r2.status}/${r2.body?.error?.code}`);
      const after = await counters(P.p1);
      assert(after.bytes === before.bytes + src.size && after.files === before.files + 1 && after.docs === before.docs + 1, "exactly one committed, no drift");
      return `one 201, one 507; storage +${src.size} B`;
    } finally {
      await M.Project.updateOne({ _id: P.p1 }, { $set: { quotaBytes: null } });
    }
  });

  await test("A15 finalize — Mongo failure → no file, no drift, bytes removed", async () => {
    const before = await counters(P.p1);
    const objsBefore = dataObjectCount();
    const s = expectOk(await begin(api, { filename: "mongo.bin", size: src.size, chunkSize: MiB }), 201);
    await sendRange(api, s.uploadId, src, MiB, 0, 4);
    const db = M.mongoose.connection.db;
    await db.command({ collMod: "file_objects", validator: { __never: { $exists: true } }, validationLevel: "strict", validationAction: "error" });
    let r;
    try {
      r = await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, MiB)) });
    } finally {
      await db.command({ collMod: "file_objects", validator: {}, validationLevel: "off" });
    }
    expectErr(r, 503, "STORAGE_UNAVAILABLE");
    const after = await counters(P.p1);
    assert(after.bytes === before.bytes && after.files === before.files && after.docs === before.docs, "no counter drift / no leaked quota");
    assert(dataObjectCount() === objsBefore, "promoted bytes rolled back");
    assert((await sessionDoc(s.uploadId)).status === "failed", "session failed");
  });

  await test("A15 finalize — disk rename failure (temp share-locked) → no file, no drift", async () => {
    const before = await counters(P.p1);
    const s = expectOk(await begin(api, { filename: "lock.bin", size: src.size, chunkSize: MiB }), 201);
    await sendRange(api, s.uploadId, src, MiB, 0, 4);
    const tp = tempPathOf((await sessionDoc(s.uploadId)).tmpObjId);
    // Hold the file open with FILE_SHARE_READ only: reads work, rename/delete fail.
    const locker = spawn("powershell", ["-NoProfile", "-Command", `$f=[System.IO.File]::Open('${tp}','Open','Read','Read'); [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); Start-Sleep -Seconds 8; $f.Close()`], { stdio: ["ignore", "pipe", "ignore"] });
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("locker did not start")), 20000);
      locker.stdout.on("data", (d) => { if (String(d).includes("LOCKED")) { clearTimeout(t); res(); } });
    });
    const r = await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, MiB)) });
    await new Promise((res) => locker.on("exit", res));
    expectErr(r, 503, "STORAGE_UNAVAILABLE");
    const after = await counters(P.p1);
    assert(after.bytes === before.bytes && after.files === before.files && after.docs === before.docs, "no counter drift");
    assert((await sessionDoc(s.uploadId)).status === "failed", "session failed");
    const clean = await M.maintenance.cleanChunkSessions({ orphanMinAgeMinutes: 0 });
    assert(!fs.existsSync(tp), "leftover temp reaped by maintenance");
    return `maintenance: ${JSON.stringify(clean)}`;
  });

  await test("A15 finalize — missing temp file → UPLOAD_DATA_MISSING", async () => {
    const s = expectOk(await begin(api, { filename: "gone.bin", size: src.size, chunkSize: MiB }), 201);
    await sendRange(api, s.uploadId, src, MiB, 0, 4);
    fs.unlinkSync(tempPathOf((await sessionDoc(s.uploadId)).tmpObjId));
    expectErr(await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, MiB)) }), 409, "UPLOAD_DATA_MISSING");
    assert((await sessionDoc(s.uploadId)).status === "failed", "session failed");
  });

  await test("A6 slot lifetime — held begin→end, shared with single-shot uploads", async () => {
    await abortAllActive({ api, dash }, P.p1);
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(expectOk(await begin(api, { filename: `slot${i}.bin`, size: src.size, chunkSize: MiB }), 201).uploadId);
    expectErr(await begin(api, { filename: "slot3.bin", size: src.size, chunkSize: MiB }), 429, "TOO_MANY_CONCURRENT_TRANSFERS");
    const single = await call("POST", "/api/v1/files", { key: K.k1, body: Buffer.from("hello"), headers: { "Content-Type": "application/octet-stream", "x-file-name": "s.txt" } });
    expectErr(single, 429, "TOO_MANY_CONCURRENT_TRANSFERS");
    await abort(api, ids.pop());
    const n = expectOk(await begin(api, { filename: "slot4.bin", size: src.size, chunkSize: MiB }), 201);
    ids.push(n.uploadId);
    return `limit 3 enforced for chunked + single-shot; abort frees a slot (live: ${ids.length})`;
  });

  await test("A10/A6 server restart — progress persisted, slots rehydrated, upload completes", async () => {
    // Three sessions are live from the previous test (limit 3). Advance one to 2/4.
    const live = await M.UploadSession.find({ projectId: P.p1, status: "active" }).lean();
    assert(live.length === 3, `expected 3 live sessions, have ${live.length}`);
    const target = live[0];
    await sendRange(api, target.uploadId, src, MiB, 0, 2);
    await stopServer();
    await startServer({}, "restart");
    expectErr(await begin(api, { filename: "after.bin", size: src.size, chunkSize: MiB }), 429, "TOO_MANY_CONCURRENT_TRANSFERS");
    const st = expectOk(await status(api, target.uploadId));
    assert(st.nextIndex === 2 && st.bytesReceived === 2 * MiB, `resumed at ${st.nextIndex}`);
    await sendRange(api, target.uploadId, src, MiB, 2, 4);
    const d = expectOk(await complete(api, target.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, MiB)) }), 201);
    assert(d.file.checksumSha256 === SRC_SHA, "sha after restart");
    expectOk(await begin(api, { filename: "after.bin", size: src.size, chunkSize: MiB }), 201);
    await abortAllActive({ api, dash }, P.p1);
    return "resumed at chunk 2 after restart; 4th begin refused until the upload finished";
  });

  await test("A9 maintenance — reaps orphans, never a live session's temp", async () => {
    const s = expectOk(await begin(api, { filename: "live.bin", size: src.size, chunkSize: MiB }), 201);
    expectOk(await append(api, s.uploadId, 0, await src.read(0, MiB)));
    const liveTmp = tempPathOf((await sessionDoc(s.uploadId)).tmpObjId);
    const orphan = path.join(CHUNK_DIR, `${crypto.randomBytes(16).toString("hex")}.part`);
    fs.writeFileSync(orphan, "orphan");
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    fs.utimesSync(orphan, old, old);
    fs.utimesSync(liveTmp, old, old); // a paused upload: old mtime, still live
    const r = await M.maintenance.cleanChunkSessions();
    assert(!fs.existsSync(orphan), "orphan removed");
    assert(fs.existsSync(liveTmp), "live temp kept despite old mtime");
    await abort(api, s.uploadId);
    return JSON.stringify(r);
  });
}

// ═════════════════════════ A6/A9 — idle expiry by time (TTL 3 s) ═════════════════════════
async function suiteTtl() {
  const api = apiPlane(K.k1);
  const buf = detBuffer(2 * MiB, "ttl");
  await test("A6/A9 idle expiry by time frees slots; maintenance cleans expired", async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const s = expectOk(await begin(api, { filename: `t${i}.bin`, size: buf.length, chunkSize: MiB }), 201);
      expectOk(await append(api, s.uploadId, 0, buf.subarray(0, MiB)));
      ids.push(s.uploadId);
    }
    expectErr(await begin(api, { filename: "t3.bin", size: buf.length, chunkSize: MiB }), 429, "TOO_MANY_CONCURRENT_TRANSFERS");
    await sleep(4500); // > 3 s idle TTL, no request touches the old sessions
    const fresh = expectOk(await begin(api, { filename: "t4.bin", size: buf.length, chunkSize: MiB }), 201);
    const temps = await Promise.all(ids.map(async (id) => tempPathOf((await sessionDoc(id)).tmpObjId)));
    const r = await M.maintenance.cleanChunkSessions();
    assert(r.expired >= 3, `expired ${r.expired}`);
    assert(temps.every((t) => !fs.existsSync(t)), "expired temps removed");
    assert(fs.existsSync(tempPathOf((await sessionDoc(fresh.uploadId)).tmpObjId)), "fresh session untouched");
    expectErr(await append(api, ids[0], 1, buf.subarray(MiB)), 410, "UPLOAD_SESSION_EXPIRED");
    await abort(api, fresh.uploadId);
    return JSON.stringify(r);
  });
}

// ═════════════════════════ A7 — disk safety re-checked per chunk ═════════════════════════
let diskFreeAtStart = 0;
async function suiteDisk() {
  const api = apiPlane(K.k1);
  const size = 60 * MiB;
  const buf = detBuffer(size, "disk");
  const src = bufSource(buf);
  await test("A7/B10 disk safety — low disk mid-upload → INSUFFICIENT_STORAGE, then continues", async () => {
    const s = expectOk(await begin(api, { filename: "disk.bin", size, chunkSize: 8 * MiB }), 201);
    await sendRange(api, s.uploadId, src, 8 * MiB, 0, 1);
    const filler = path.join(WORK, "storage", "filler.bin");
    const fh = await fsp.open(filler, "w");
    const block = Buffer.alloc(8 * MiB);
    for (let i = 0; i < 44; i++) await fh.write(block); // 352 MiB pushes free space under the floor
    await fh.sync();
    await fh.close();
    let r;
    try {
      r = await append(api, s.uploadId, 1, await src.read(8 * MiB, 16 * MiB));
    } finally {
      fs.unlinkSync(filler);
    }
    expectErr(r, 507, "INSUFFICIENT_STORAGE");
    const st = expectOk(await status(api, s.uploadId));
    assert(st.nextIndex === 1, "progress preserved");
    await sendRange(api, s.uploadId, src, 8 * MiB, 1, s.totalChunks);
    const d = expectOk(await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, 8 * MiB)) }), 201);
    assert(d.file.checksumSha256 === sha256(buf), "sha exact");
    return "rejected while below MIN_FREE_DISK_BYTES, completed after space returned";
  });
}

// ═════════════════════════ B — live matrix ═════════════════════════
const matrixRows = [];
async function matrixUpload(sizeMiB, plane = "api") {
  const pl = plane === "api" ? apiPlane(K.k1) : dashPlane(P.p1, C.a);
  const file = path.join(WORK, `src-${sizeMiB}-${plane}.bin`);
  const srcSha = await writeDetFile(file, sizeMiB * MiB, `m${sizeMiB}`);
  const src = await fileSource(file);
  const pid = pidOnPort(PORT);
  const rss0 = pid ? await rssMB(pid) : null;
  const sampler = pid ? rssSampler(pid) : null;
  const t0 = performance.now();
  const s = expectOk(await begin(pl, { filename: `m${sizeMiB}-${plane}.bin`, size: src.size }), 201);
  const hashes = await sendRange(pl, s.uploadId, src, s.chunkSize, 0, s.totalChunks);
  const d = expectOk(await complete(pl, s.uploadId, { manifestSha256: manifest(hashes), sha256: srcSha }), 201);
  const ms = performance.now() - t0;
  const peak = sampler ? await sampler.end() : null;
  const rss1 = pid ? await rssMB(pid) : null;
  const dl = await downloadSha(K.k1, d.fileId);
  await src.close();
  const row = {
    size: `${sizeMiB} MiB`,
    plane: plane === "api" ? "API" : "dashboard",
    bytes: src.size,
    chunkSize: s.chunkSize,
    chunks: s.totalChunks,
    seconds: +(ms / 1000).toFixed(2),
    mbps: +((src.size / MiB) / (ms / 1000)).toFixed(1),
    rss: rss0 != null ? `${rss0.toFixed(0)}→peak ${peak.toFixed(0)}→${rss1.toFixed(0)} MB (Δpeak ${(peak - rss0).toFixed(0)} MB)` : "n/a",
    stored: d.file.sizeBytes,
    downloaded: dl.bytes,
    srcSha,
    serverSha: d.file.checksumSha256,
    downloadSha: dl.sha,
    pass: d.file.sizeBytes === src.size && d.file.checksumSha256 === srcSha && dl.sha === srcSha && dl.bytes === src.size,
  };
  matrixRows.push(row);
  await fsp.unlink(file).catch(() => {});
  assert(row.pass, "checksum/size mismatch");
  return `${row.chunks}×${(row.chunkSize / MiB).toFixed(0)} MiB, ${row.seconds}s, ${row.mbps} MB/s; size ${src.size} = stored ${row.stored} = download ${row.downloaded}; sha ${srcSha.slice(0, 12)}… = server = download`;
}

async function interruptResume(sizeMiB, label) {
  const api = apiPlane(K.k1);
  const file = path.join(WORK, `ir-${sizeMiB}.bin`);
  const srcSha = await writeDetFile(file, sizeMiB * MiB, `ir${sizeMiB}`);
  const src = await fileSource(file);
  const s = expectOk(await begin(api, { filename: `ir${sizeMiB}.bin`, size: src.size, chunkSize: 16 * MiB }), 201);
  const cut = Math.ceil(s.totalChunks * 0.3);
  await sendRange(api, s.uploadId, src, s.chunkSize, 0, cut);
  const c = await src.read(cut * s.chunkSize, Math.min((cut + 1) * s.chunkSize, src.size));
  const how = await appendInterrupted(api, s.uploadId, cut, c, sha256(c), 0.4);
  // A NEW client picks the upload up purely from the server's view.
  await sleep(400);
  const st = expectOk(await status(api, s.uploadId));
  assert(st.nextIndex === cut && st.bytesReceived === cut * s.chunkSize && st.bytesReceived > 0, `resume point ${st.nextIndex}`);
  await sendRange(api, s.uploadId, src, s.chunkSize, st.nextIndex, s.totalChunks);
  const d = expectOk(await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, s.chunkSize)), sha256: srcSha }), 201);
  const dl = await downloadSha(K.k1, d.fileId);
  await src.close();
  await fsp.unlink(file).catch(() => {});
  assert(d.file.checksumSha256 === srcSha && dl.sha === srcSha, "sha");
  return `${label}: interrupted in chunk ${cut}/${s.totalChunks} (${how}); resumed at ${((st.bytesReceived / src.size) * 100).toFixed(0)}% — not from zero; sha matches`;
}

async function suiteMatrix() {
  const sizes = SHORT ? [20, 100] : [20, 100, 250, 900];
  for (const sz of sizes) await test(`B matrix ${sz} MiB (API)`, () => matrixUpload(sz, "api"));
  if (SHORT) for (const sz of sizes) await test(`B matrix ${sz} MiB (dashboard)`, () => matrixUpload(sz, "dash"));
  for (const sz of SHORT ? [100] : [250, 900]) await test(`B1 interrupt ~30% + resume (${sz} MiB)`, () => interruptResume(sz, `${sz} MiB`));

  const api = apiPlane(K.k1);
  const mid = detBuffer(96 * MiB, "mid"); // 6 chunks of 16 MiB
  const src = bufSource(mid);
  const CS = 16 * MiB;
  await test("B2 failed middle chunk retried (reset + storage error), completes", async () => {
    const s = expectOk(await begin(api, { filename: "b2.bin", size: src.size, chunkSize: CS }), 201);
    await sendRange(api, s.uploadId, src, CS, 0, 3);
    const c3 = await src.read(3 * CS, 4 * CS);
    await appendInterrupted(api, s.uploadId, 3, c3, sha256(c3), 0.6);
    await sleep(300);
    const tp = tempPathOf((await sessionDoc(s.uploadId)).tmpObjId);
    fs.chmodSync(tp, 0o444);
    let r;
    try {
      r = await appendSettled(api, s.uploadId, 3, c3, sha256(c3));
    } finally {
      fs.chmodSync(tp, 0o666);
    }
    expectErr(r, 503, "STORAGE_UNAVAILABLE");
    const st = expectOk(await status(api, s.uploadId));
    assert(st.nextIndex === 3 && st.bytesReceived === 3 * CS, "chunks 0-2 preserved");
    await sendRange(api, s.uploadId, src, CS, 3, 6);
    const d = expectOk(await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, CS)) }), 201);
    assert(d.file.checksumSha256 === sha256(mid), "sha");
    return "chunk 3 failed twice (reset, then 503) and was retried alone";
  });
  await test("B3 duplicate chunk — no double append, exact file", async () => {
    const s = expectOk(await begin(api, { filename: "b3.bin", size: src.size, chunkSize: CS }), 201);
    await sendRange(api, s.uploadId, src, CS, 0, 3);
    const c1 = await src.read(CS, 2 * CS);
    const dup = expectOk(await append(api, s.uploadId, 1, c1));
    assert(dup.alreadyAccepted && dup.bytesReceived === 3 * CS, "ack only");
    await sendRange(api, s.uploadId, src, CS, 3, 6);
    const d = expectOk(await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, CS)) }), 201);
    const dl = await downloadSha(K.k1, d.fileId);
    assert(d.file.sizeBytes === src.size && dl.sha === sha256(mid), "exact");
  });
  await test("B4 corrupted chunk (bytes changed, original checksum) → CHUNK_CHECKSUM_MISMATCH, resumable", async () => {
    const s = expectOk(await begin(api, { filename: "b4.bin", size: src.size, chunkSize: CS }), 201);
    await sendRange(api, s.uploadId, src, CS, 0, 2);
    const good = Buffer.from(await src.read(2 * CS, 3 * CS));
    const bad = Buffer.from(good);
    bad[12345] ^= 0xff;
    expectErr(await append(api, s.uploadId, 2, bad, sha256(good)), 422, "CHUNK_CHECKSUM_MISMATCH");
    const st = expectOk(await status(api, s.uploadId));
    assert(st.nextIndex === 2, "still at chunk 2");
    await sendRange(api, s.uploadId, src, CS, 2, 6);
    const d = expectOk(await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, CS)) }), 201);
    assert(d.file.checksumSha256 === sha256(mid), "sha");
  });
  const RS = SHORT ? 100 : 900;
  await test(`B6 server restart at ~30% of ${RS} MiB → resumes, SHA matches`, async () => {
    const file = path.join(WORK, `rs-${RS}.bin`);
    const srcSha = await writeDetFile(file, RS * MiB, `rs${RS}`);
    const fsrc = await fileSource(file);
    const s = expectOk(await begin(api, { filename: `rs${RS}.bin`, size: fsrc.size, ...(SHORT ? { chunkSize: 16 * MiB } : {}) }), 201);
    const cut = Math.ceil(s.totalChunks * 0.3);
    await sendRange(api, s.uploadId, fsrc, s.chunkSize, 0, cut);
    await stopServer();
    await startServer({ MAX_CONCURRENT_UPLOADS_PER_PROJECT: "10" }, "b6");
    const st = expectOk(await status(api, s.uploadId));
    assert(st.nextIndex === cut, `resume point ${st.nextIndex}`);
    await sendRange(api, s.uploadId, fsrc, s.chunkSize, cut, s.totalChunks);
    const d = expectOk(await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(fsrc, s.chunkSize)), sha256: srcSha }), 201);
    const dl = await downloadSha(K.k1, d.fileId);
    await fsrc.close();
    await fsp.unlink(file).catch(() => {});
    assert(d.file.checksumSha256 === srcSha && dl.sha === srcSha, "sha");
    return `restarted after chunk ${cut}/${s.totalChunks}; resumed at ${cut}; sha ${srcSha.slice(0, 12)}…`;
  });
  await test("B7 logout / session expiry mid-upload (dashboard)", async () => {
    const dash = dashPlane(P.p1, C.a);
    const s = expectOk(await begin(dash, { filename: "b7.bin", size: src.size, chunkSize: CS }), 201);
    await sendRange(dash, s.uploadId, src, CS, 0, 2);
    const c2 = await src.read(2 * CS, 3 * CS);
    expectErr(await append(dashPlane(P.p1, C.aExpired), s.uploadId, 2, c2), 401, "UNAUTHENTICATED");
    const noCookie = await call("POST", `${dash.base}?op=append&uploadId=${s.uploadId}&index=2`, { body: c2, headers: { "x-chunk-sha256": sha256(c2) } });
    expectErr(noCookie, 401, "UNAUTHENTICATED");
    expectErr(await append(dashPlane(P.p1, C.s), s.uploadId, 2, c2), 403, "UPLOAD_SESSION_FORBIDDEN");
    const fresh = await cookieFor(U.a); // the same user signs in again
    await sendRange(dashPlane(P.p1, fresh), s.uploadId, src, CS, 2, 6);
    const d = expectOk(await complete(dashPlane(P.p1, fresh), s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, CS)) }), 201);
    assert(d.file.checksumSha256 === sha256(mid), "sha");
    return "expired/absent cookie → 401; other admin → 403; same user after re-login continues";
  });
  await test("B8 project disabled mid-upload → rejected, no file; re-enabled → continues", async () => {
    const before = await counters(P.p1);
    const s = expectOk(await begin(api, { filename: "b8.bin", size: src.size, chunkSize: CS }), 201);
    await sendRange(api, s.uploadId, src, CS, 0, 3);
    await M.Project.updateOne({ _id: P.p1 }, { $set: { status: "disabled" } });
    try {
      expectErr(await append(api, s.uploadId, 3, await src.read(3 * CS, 4 * CS)), 403, "PROJECT_DISABLED");
      expectErr(await complete(api, s.uploadId, { manifestSha256: "0".repeat(64) }), 403, "PROJECT_DISABLED");
      const mid2 = await counters(P.p1);
      assert(mid2.docs === before.docs, "no active file while disabled");
      const doc = await sessionDoc(s.uploadId);
      assert(fs.statSync(tempPathOf(doc.tmpObjId)).size === 3 * CS, "temp kept");
    } finally {
      await M.Project.updateOne({ _id: P.p1 }, { $set: { status: "active" } });
    }
    await sendRange(api, s.uploadId, src, CS, 3, 6);
    expectOk(await complete(api, s.uploadId, { manifestSha256: manifest(await chunkHashesOf(src, CS)) }), 201);
    return "policy: rejected while disabled, temp kept; resumed after re-enable";
  });
  await test("B9 quota race (2 × 96 MiB, room for one)", async () => {
    const before = await counters(P.p1);
    await M.Project.updateOne({ _id: P.p1 }, { $set: { quotaBytes: before.bytes + Math.floor(src.size * 1.5) } });
    try {
      const a = expectOk(await begin(api, { filename: "b9a.bin", size: src.size, chunkSize: CS }), 201);
      const b = expectOk(await begin(api, { filename: "b9b.bin", size: src.size, chunkSize: CS }), 201);
      await Promise.all([sendRange(api, a.uploadId, src, CS, 0, 6), sendRange(api, b.uploadId, src, CS, 0, 6)]);
      const m = manifest(await chunkHashesOf(src, CS));
      const rs = await Promise.all([complete(api, a.uploadId, { manifestSha256: m }), complete(api, b.uploadId, { manifestSha256: m })]);
      assert(rs.filter((r) => r.status === 201).length === 1 && rs.filter((r) => r.body?.error?.code === "STORAGE_QUOTA_EXCEEDED").length === 1, "exactly one commit");
      const after = await counters(P.p1);
      assert(after.bytes === before.bytes + src.size && after.docs === before.docs + 1, "no bypass");
    } finally {
      await M.Project.updateOne({ _id: P.p1 }, { $set: { quotaBytes: null } });
    }
  });
}

// ═════════════════════════ serve (browser tests) ═════════════════════════
async function serveMode() {
  const { hashPassword } = await import("@/lib/auth/password");
  const pw = "Tst-" + crypto.randomBytes(12).toString("base64url") + "9!";
  await M.User.updateOne({ _id: U.a._id }, { $set: { passwordHash: await hashPassword(pw), mustChangePassword: false } });
  const credFile = path.join(WORK, "test-credentials.json");
  fs.writeFileSync(credFile, JSON.stringify({ url: BASE, email: U.a.email, password: pw, projectId: P.p1, apiKey: K.k1, storageRoot: STORAGE_ROOT, mongoUri: MONGO_URI }, null, 2));
  await startServer({ MAX_CONCURRENT_UPLOADS_PER_PROJECT: "10" }, "serve");
  console.log(`SERVING ${BASE} project ${P.p1} — credentials in ${credFile}`);
  await new Promise(() => {}); // until stopped
}

// ═════════════════════════ main ═════════════════════════
async function main() {
  console.log(`work dir: ${WORK}`);
  if (PROD) {
    const idFile = path.join(ROOT, ".next", "BUILD_ID");
    if (!fs.existsSync(idFile)) throw new Error("no production build in .next — run `npm run build` first");
    console.log(`mode: production — next start on .next (BUILD_ID ${fs.readFileSync(idFile, "utf8").trim()})`);
  }
  await startMongo();
  await loadApp();
  await seed();
  if (SERVE) return serveMode();

  if (MATRIX_ONLY) {
    await startServer({ MAX_CONCURRENT_UPLOADS_PER_PROJECT: "10" }, "matrix");
    await suiteMatrix();
    return;
  }
  await startServer({}, "core");
  await suiteCore();

  await stopServer();
  await startServer({ CHUNK_SESSION_IDLE_TTL_MINUTES: "0.05" }, "ttl");
  await suiteTtl();

  await stopServer();
  const vol = fs.statfsSync(path.join(WORK, "storage"));
  diskFreeAtStart = vol.bavail * vol.bsize;
  await startServer({ MIN_FREE_DISK_BYTES: String(diskFreeAtStart - 300 * MiB) }, "disk");
  await suiteDisk();

  if (MATRIX) {
    await stopServer();
    await startServer({ MAX_CONCURRENT_UPLOADS_PER_PROJECT: "10" }, "matrix");
    await suiteMatrix();
  }

  await test("Security — no temp id / path / .part in any API response", async () => {
    const tmpIds = (await M.UploadSession.find({}).select("tmpObjId").lean()).map((s) => s.tmpObjId);
    const blob = captured.join("\n");
    assert(!blob.includes("tmpObjId") && !blob.includes(".part") && !blob.includes(WORK.replace(/\\/g, "\\\\")) && !blob.includes(WORK), "path leaked");
    assert(!tmpIds.some((t) => blob.includes(t)), "temp id leaked");
    return `${captured.length} responses scanned`;
  });
  await test("Security — no API key in the browser upload client", async () => {
    const src = fs.readFileSync(path.join(ROOT, "lib", "uploadClient.js"), "utf8");
    assert(!/Authorization|Bearer|apiKey|gsk_/i.test(src.replace(/\/\/.*$/gm, "")), "key reference found");
  });

  await stopServer(); // flush: every server log of the run is complete
  await test("Security — server logs: no absolute paths, no secrets", async () => {
    const files = fs.readdirSync(WORK).filter((f) => /^server-.*\.log$/.test(f));
    const logs = files.map((f) => fs.readFileSync(path.join(WORK, f), "utf8")).join("\n");
    const lower = logs.toLowerCase();
    const forms = (p) => [p, p.replace(/\\/g, "/"), p.replace(/\\/g, "\\\\")].map((v) => v.toLowerCase());
    const leaks = [];
    for (const [label, p] of [["work dir", WORK], ["app dir", ROOT], ["storage root", STORAGE_ROOT], ["temp dir", os.tmpdir()], ["home dir", os.homedir()]]) {
      if (forms(path.resolve(p)).some((v) => lower.includes(v))) leaks.push(label);
    }
    const drive = /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s'"]*/.exec(logs);
    if (drive) leaks.push("a drive-letter path");
    const secrets = [
      ["JWT secret", JWT_SECRET],
      ["key pepper", KEY_HASH_PEPPER],
      ...Object.entries(K).map(([k, v]) => [`API key ${k}`, v.split("_").pop()]),
      ...Object.entries(C).map(([k, v]) => [`session cookie ${k}`, v.slice(v.indexOf("=") + 1)]),
    ];
    for (const [label, v] of secrets) if (v && logs.includes(v)) leaks.push(label);
    if (/\bBearer\s+[A-Za-z0-9]/.test(logs)) leaks.push("an Authorization header");
    if (/mongodb(?:\+srv)?:\/\/[^\s/@:]+:[^\s/@]+@/i.test(logs)) leaks.push("Mongo credentials");
    assert(!leaks.length, `found in server logs: ${leaks.join(", ")}`);
    // The failures that used to print paths really happened in this run — and
    // were logged, path-free.
    const seen = ["[ingest.commit]", "[ingest.metadata]", "[chunk.append"].filter((t) => logs.includes(t));
    if (!ONLY && !MATRIX_ONLY) assert(seen.length === 3, `expected failure log lines missing (saw: ${seen.join(" ") || "none"})`);
    return `${files.length} server logs, ${logs.split("\n").length} lines; failure lines present: ${seen.join(" ")}`;
  });
}

let exitCode = 0;
try {
  await main();
} catch (e) {
  console.error("HARNESS ERROR:", e.stack || e.message);
  exitCode = 2;
} finally {
  await stopServer().catch(() => {});
  if (mongoProc) killTree(mongoProc.pid);
  await M.mongoose?.disconnect().catch(() => {});
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`server starts: ${serverRun} (${PROD ? "next start, production build" : "next dev"}); restarted for a missing route: ${devRouteRestarts.length}`);
if (matrixRows.length) {
  console.log("\nLive matrix:");
  console.table(matrixRows.map(({ srcSha, serverSha, downloadSha, ...r }) => ({ ...r, sha: srcSha === serverSha && srcSha === downloadSha ? "MATCH" : "MISMATCH" })));
  for (const r of matrixRows) console.log(`  ${r.size}: src ${r.srcSha}\n          srv ${r.serverSha}\n          dl  ${r.downloadSha}`);
}
fs.writeFileSync(path.join(WORK, "results.json"), JSON.stringify({ mode: PROD ? "production" : "dev", results, matrix: matrixRows, serverStarts: serverRun, devRouteRestarts }, null, 2));
console.log(`results: ${path.join(WORK, "results.json")}`);
if (!process.env.TEST_KEEP) await fsp.rm(WORK, { recursive: true, force: true }).catch(() => {});
process.exit(exitCode || (failed.length ? 1 : 0));
