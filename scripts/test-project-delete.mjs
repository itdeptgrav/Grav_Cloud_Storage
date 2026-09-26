// scripts/test-project-delete.mjs
// Verification of PERMANENT project deletion (DELETE /api/projects/:id/permanent)
// against an ISOLATED instance: its own mongod (temp dbpath), temp STORAGE_ROOT,
// its own port (and, in dev mode, its own Next build dir .next-deltest). It never
// touches the real database, the real storage directory or any real project.
//
//   node --import ./scripts/alias-register.mjs scripts/test-project-delete.mjs          # next dev
//   … --prod            run `next start` on the PRODUCTION build in .next (npm run build first)
//   … --only <text>     run only tests whose name contains it
//   … --serve           seed a throwaway login user + the test project "zz-delete-project-test"
//                       (random password in <work>/test-credentials.json, never printed)
//                       and keep the instance up for a browser test of the UI
//
// env: TEST_MONGOD_BIN · TEST_PORT (4200) · TEST_MONGO_PORT (27041) · TEST_WORK_DIR · TEST_KEEP=1
//
// A failed deletion is provoked from the OUTSIDE — a separate process holds a
// trashed object open with no sharing (as a backup tool or antivirus scanner
// can), so its delete fails with EBUSY — no fault hooks in the app.

import { spawn, spawnSync } from "node:child_process";
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
const PORT = Number(process.env.TEST_PORT || 4200);
const MONGO_PORT = Number(process.env.TEST_MONGO_PORT || 27041);
const SERVE = process.argv.includes("--serve");
const PROD = process.argv.includes("--prod");
const ONLY = (() => { const i = process.argv.indexOf("--only"); return i > 0 ? process.argv[i + 1] : null; })();
const BASE = `http://localhost:${PORT}`;
const MiB = 1048576;
const WORK = await fsp.mkdtemp(path.join(process.env.TEST_WORK_DIR || os.tmpdir(), "gs-deltest-"));
const STORAGE_ROOT = path.join(WORK, "storage", "data");
const TRASH_ROOT = path.join(WORK, "storage", "trash");
const TMP_ROOT = path.join(WORK, "storage", "tmp");
const CHUNK_DIR = path.join(TMP_ROOT, "chunked");
const MONGO_URI = `mongodb://127.0.0.1:${MONGO_PORT}/grav_deltest`;
const JWT_SECRET = "deltest-jwt-" + crypto.randomBytes(12).toString("hex");
const KEY_HASH_PEPPER = "deltest-pepper-" + crypto.randomBytes(12).toString("hex");
const TEST_NAME = "zz-delete-project-test";

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
const captured = [];
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
const devRouteRestarts = [];

function killTree(pid) {
  if (pid) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
}
async function portOpen(port) {
  return new Promise((res) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => { s.destroy(); res(true); });
    s.once("error", () => res(false));
  });
}
async function startMongo() {
  const dbpath = path.join(WORK, "mongo");
  await fsp.mkdir(dbpath, { recursive: true });
  mongoProc = spawn(findMongod(), ["--dbpath", dbpath, "--port", String(MONGO_PORT), "--bind_ip", "127.0.0.1", "--quiet"], { stdio: "ignore" });
  const until = Date.now() + 30000;
  while (!(await portOpen(MONGO_PORT))) {
    if (Date.now() > until) throw new Error("mongod did not start");
    await sleep(300);
  }
}
function serverEnv() {
  const env = {
    ...process.env,
    NODE_ENV: PROD ? "production" : "development",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_DIST_DIR: ".next-deltest",
    BOOTSTRAP_ADMIN_EMAIL: "",
    BOOTSTRAP_ADMIN_PASSWORD: "",
    BOOTSTRAP_ADMIN_RESET: "",
    PORT: String(PORT),
    MONGODB_URI: MONGO_URI,
    STORAGE_ROOT,
    JWT_SECRET,
    KEY_HASH_PEPPER,
    MAX_UPLOAD_SIZE_BYTES: String(2 * 1024 * MiB),
    MAX_CONCURRENT_UPLOADS_PER_PROJECT: "10",
    MAX_CONCURRENT_DOWNLOADS_PER_PROJECT: "10",
    MIN_FREE_DISK_BYTES: "0",
    API_RATE_LIMIT_REQUESTS: "100000",
    AUTH_RATE_LIMIT_REQUESTS: "1000",
  };
  if (PROD) delete env.NEXT_DIST_DIR;
  return env;
}
async function startServer() {
  for (let attempt = 1; ; attempt++) {
    const logFile = await launchServer();
    const warm = [
      await call("GET", "/api/v1/files?limit=1", { key: K.c }),
      await call("GET", `/api/projects/${P.c}/permanent`, { cookie: C.a }),
      await call("GET", `/api/dashboard/projects/${P.c}/files?limit=1`, { cookie: C.a }),
      await call("GET", `/api/dashboard/projects/${P.c}/files/chunk?op=list`, { cookie: C.a }),
      await call("GET", "/api/v1/files/file_warmup0000000000000000", { key: K.c }),
    ];
    const missing = warm.map((r, i) => (r.body ? null : `warmup #${i + 1} → ${r.status} non-JSON`)).filter(Boolean);
    if (!missing.length) return logFile;
    devRouteRestarts.push({ server: path.basename(logFile), missing });
    console.log(`NOTE  server ${path.basename(logFile)} started without a route (${missing.join("; ")}) — restarting it`);
    if (attempt >= 3) throw new Error(`server kept starting without its routes (see ${logFile})`);
    await stopServer();
  }
}
async function launchServer() {
  serverRun++;
  const logFile = path.join(WORK, `server-${serverRun}.log`);
  const fd = fs.openSync(logFile, "a");
  serverProc = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), PROD ? "start" : "dev", "-p", String(PORT)], {
    cwd: ROOT,
    env: serverEnv(),
    stdio: ["ignore", fd, fd],
  });
  const until = Date.now() + 240000;
  while (Date.now() < until) {
    try {
      const j = await fetch(`${BASE}/api/health`).then((r) => r.json());
      if (j?.checks?.database === "up") return logFile;
    } catch {
      /* not up yet */
    }
    await sleep(800);
  }
  throw new Error(`server did not become healthy (see ${logFile})`);
}
async function stopServer() {
  if (!serverProc) return;
  killTree(serverProc.pid);
  serverProc = null;
  for (let i = 0; i < 50 && (await portOpen(PORT)); i++) await sleep(200);
}

// ───────────────────────── app handles ─────────────────────────
Object.assign(process.env, { MONGODB_URI: MONGO_URI, STORAGE_ROOT, JWT_SECRET, KEY_HASH_PEPPER });
const M = {};
const U = {}; // users
const P = {}; // project ids
const K = {}; // raw API keys (test-only)
const C = {}; // session cookies (test-only)

async function loadApp() {
  M.mongoose = (await import("mongoose")).default;
  M.connectDB = (await import("@/lib/db/mongoose")).connectDB;
  M.User = (await import("@/lib/db/models/User")).default;
  M.Project = (await import("@/lib/db/models/Project")).default;
  M.FileObject = (await import("@/lib/db/models/FileObject")).default;
  M.UploadSession = (await import("@/lib/db/models/UploadSession")).default;
  M.ApiKey = (await import("@/lib/db/models/ApiKey")).default;
  M.UsageDaily = (await import("@/lib/db/models/UsageDaily")).default;
  M.RequestLog = (await import("@/lib/db/models/RequestLog")).default;
  M.AuditLog = (await import("@/lib/db/models/AuditLog")).default;
  M.apiKeys = await import("@/lib/services/apiKeyService");
  M.integrity = await import("@/lib/integrity");
  M.reconcile = await import("@/lib/reconcile");
  M.SignJWT = (await import("jose")).SignJWT;
  await M.connectDB();
}
async function cookieFor(user) {
  const now = Math.floor(Date.now() / 1000);
  const t = await new M.SignJWT({ role: user.role, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user._id))
    .setIssuedAt(now)
    .setExpirationTime(now + 4 * 3600)
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `gs_session=${t}`;
}
async function mkProject(owner, name, keyName) {
  const p = await M.Project.create({ ownerId: owner._id, name, status: "active", quotaBytes: null });
  const { rawKey } = await M.apiKeys.createApiKey(p, { name: keyName, scopes: M.apiKeys.VALID_SCOPES });
  return { id: String(p._id), key: rawKey };
}
async function seed() {
  const mk = (name, email, role) => M.User.create({ name, email, passwordHash: "x", role, status: "active" });
  U.a = await mk("Owner A", "owner-a@deltest.local", "user");
  U.b = await mk("User B", "user-b@deltest.local", "user");
  U.s = await mk("Admin S", "admin-s@deltest.local", "superadmin");
  C.a = await cookieFor(U.a);
  C.b = await cookieFor(U.b);
  C.s = await cookieFor(U.s);
  // control project — must be untouched by every deletion in this run
  ({ id: P.c, key: K.c } = await mkProject(U.a, "zz-keep-project", "control"));
}

// ───────────────────────── http ─────────────────────────
async function call(method, pathQ, { key, cookie, json, body, headers = {}, origin } = {}) {
  const h = { ...headers };
  if (key) h.Authorization = `Bearer ${key}`;
  if (cookie) {
    h.Cookie = cookie;
    if (method !== "GET" && method !== "HEAD") h.Origin = origin || BASE;
  }
  let payload = body;
  if (json !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(json);
  }
  const res = await fetch(BASE + pathQ, { method, headers: h, body: payload });
  const text = method === "HEAD" ? "" : await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (parsed) captured.push(text);
  return { status: res.status, body: parsed, text, headers: res.headers };
}
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const manifest = (hashes) => sha256(Buffer.from(hashes.join(""), "ascii"));
function detBuffer(size, seed) {
  const k = crypto.createHash("sha256").update("k" + seed).digest().subarray(0, 16);
  const iv = crypto.createHash("sha256").update("iv" + seed).digest().subarray(0, 16);
  return crypto.createCipheriv("aes-128-ctr", k, iv).update(Buffer.alloc(size));
}
async function apiUpload(key, name, buf) {
  const r = await call("POST", "/api/v1/files", { key, body: buf, headers: { "Content-Type": "application/octet-stream", "x-file-name": name } });
  return expectOk(r, 201);
}
async function dashUpload(pid, cookie, name, buf) {
  const form = new FormData();
  form.append("file", new Blob([buf]), name);
  const r = await call("POST", `/api/dashboard/projects/${pid}/files`, { cookie, body: form });
  return expectOk(r, 201);
}
const chunkBase = (pid) => `/api/dashboard/projects/${pid}/files/chunk`;
const apiChunk = "/api/v1/files/chunk";
async function beginChunked(key, name, size, chunkSize) {
  return expectOk(await call("POST", `${apiChunk}?op=begin`, { key, json: { filename: name, size, chunkSize } }), 201);
}
async function appendChunk(key, uploadId, i, buf) {
  return call("POST", `${apiChunk}?op=append&uploadId=${uploadId}&index=${i}`, { key, body: buf, headers: { "Content-Type": "application/octet-stream", "x-chunk-sha256": sha256(buf) } });
}
const trashPath = (storageKey) => path.join(TRASH_ROOT, ...storageKey.split("/"));
const dataPath = (storageKey) => path.join(STORAGE_ROOT, ...storageKey.split("/"));

// Streams that stay open (a slow download, an upload whose body trickles).
function slowDownload(key, fileId) {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/api/v1/files/${fileId}`, { headers: { Authorization: `Bearer ${key}` } }, (res) => {
      let bytes = 0;
      res.pause(); // read almost nothing: the server's stream fills its buffers and waits
      const state = { status: res.statusCode, bytes: () => bytes, ended: false, error: null };
      res.on("data", (c) => (bytes += c.length));
      res.on("end", () => (state.ended = true));
      res.on("error", (e) => (state.error = e.code || e.message));
      res.on("aborted", () => (state.error = "aborted"));
      res.on("close", () => (state.closed = true));
      state.drain = async () => {
        res.resume();
        const until = Date.now() + 20000;
        while (!state.closed && Date.now() < until) await sleep(50);
        return state;
      };
      resolve(state);
    });
    req.on("error", (e) => resolve({ status: 0, error: e.code || e.message, drain: async () => ({ error: e.code }) }));
  });
}
function trickleUpload({ pathQ, headers, prefix, total }) {
  const u = new URL(BASE + pathQ);
  const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", headers: { ...headers, "Content-Length": total } });
  const result = new Promise((resolve) => {
    req.on("error", (e) => resolve({ status: 0, reset: e.code || e.message }));
    req.on("response", (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        let code = null;
        try { code = JSON.parse(b)?.error?.code || null; } catch { /* not JSON */ }
        resolve({ status: res.statusCode, code });
      });
      res.on("error", () => resolve({ status: res.statusCode, reset: "response aborted" }));
    });
  });
  req.write(prefix);
  return { result, destroy: () => req.destroy() };
}
// Hold `file` open from another process with FileShare.None until release().
function lockExclusive(file) {
  const ps = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", "$f=[System.IO.File]::Open($env:LOCK_PATH,'Open','Read','None'); Write-Output locked; Start-Sleep -Seconds 600"], {
    env: { ...process.env, LOCK_PATH: file },
    stdio: ["ignore", "pipe", "ignore"],
  });
  return new Promise((resolve, reject) => {
    ps.stdout.on("data", (d) => {
      if (String(d).includes("locked")) resolve({ release: async () => { killTree(ps.pid); await sleep(500); } });
    });
    ps.on("exit", (c) => reject(new Error(`lock process exited (${c})`)));
  });
}
function multipartPrefix(boundary, name) {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
}

// ───────────────────────── fixtures ─────────────────────────
/**
 * Build a project with every kind of data a project can own:
 *  4 active (3 API + 1 dashboard multipart) + 1 completed chunked upload (active),
 *  2 trashed, 1 purged, 1 open chunked upload with 2 chunks on disk, 1 aborted
 *  session, 2 API keys (one revoked), request logs + usage rollups (from all of
 *  that traffic), and a stray object + empty folder in its data directory.
 */
async function buildRichProject(owner, cookie, name) {
  const { id, key } = await mkProject(owner, name, "main");
  const key2 = (await M.apiKeys.createApiKey({ _id: new M.mongoose.Types.ObjectId(id) }, { name: "second", scopes: M.apiKeys.VALID_SCOPES })).rawKey;
  const f = { active: [], trashed: [], purged: [] };
  for (const [n, size] of [["a1.bin", 1 * MiB], ["a2.bin", 2 * MiB], ["a3.bin", 5 * MiB]]) {
    const buf = detBuffer(size, `${name}-${n}`);
    const d = await apiUpload(key, n, buf);
    f.active.push({ fileId: d.fileId, sha: sha256(buf), size });
  }
  const dbuf = detBuffer(3 * MiB, `${name}-dash`);
  const dd = await dashUpload(id, cookie, "dash.bin", dbuf);
  f.active.push({ fileId: dd.fileId, sha: sha256(dbuf), size: dbuf.length });
  // chunked, completed → active file
  const cs = 5 * MiB;
  const cbuf = detBuffer(12 * MiB, `${name}-chunked`);
  const s1 = await beginChunked(key, "chunked.bin", cbuf.length, cs);
  const hashes = [];
  for (let i = 0; i < s1.totalChunks; i++) {
    const part = cbuf.subarray(i * cs, Math.min((i + 1) * cs, cbuf.length));
    hashes.push(sha256(part));
    expectOk(await appendChunk(key, s1.uploadId, i, part));
  }
  const done = expectOk(await call("POST", `${apiChunk}?op=complete&uploadId=${s1.uploadId}`, { key, json: { manifestSha256: manifest(hashes) } }), 201);
  f.active.push({ fileId: done.fileId, sha: sha256(cbuf), size: cbuf.length });
  // trashed ×2, purged ×1
  for (const n of ["t1.bin", "t2.bin", "p1.bin"]) {
    const buf = detBuffer(1 * MiB + n.length, `${name}-${n}`);
    const d = await apiUpload(key, n, buf);
    expectOk(await call("DELETE", `/api/v1/files/${d.fileId}`, { key }));
    if (n.startsWith("p")) {
      expectOk(await call("DELETE", `/api/dashboard/projects/${id}/files/${d.fileId}/purge`, { cookie }));
      f.purged.push({ fileId: d.fileId });
    } else f.trashed.push({ fileId: d.fileId, size: buf.length });
  }
  // open chunked upload: 2 of 3 chunks on disk
  const obuf = detBuffer(15 * MiB, `${name}-open`);
  const s2 = await beginChunked(key, "open.bin", obuf.length, cs);
  for (let i = 0; i < 2; i++) expectOk(await appendChunk(key, s2.uploadId, i, obuf.subarray(i * cs, (i + 1) * cs)));
  // aborted session
  const s3 = await beginChunked(key2, "aborted.bin", 6 * MiB, cs);
  expectOk(await call("POST", `${apiChunk}?op=abort&uploadId=${s3.uploadId}`, { key: key2, json: {} }));
  // key2 revoked (after use, so it has logs + usage)
  const k2 = await M.ApiKey.findOne({ projectId: id, name: "second" });
  await M.apiKeys.revokeKey(k2);
  // some reads so usage has downloads
  expectOk(await call("GET", `/api/v1/files/${f.active[0].fileId}/meta`, { key }));
  const dl = await fetch(`${BASE}/api/v1/files/${f.active[0].fileId}`, { headers: { Authorization: `Bearer ${key}`, Range: "bytes=0-1023" } });
  await dl.arrayBuffer();
  // a stray object (no record) and an empty folder in the project's data dir
  const strayDir = path.join(STORAGE_ROOT, id, "objects", "2020", "01");
  fs.mkdirSync(strayDir, { recursive: true });
  fs.writeFileSync(path.join(strayDir, "0".repeat(32)), "stray bytes");
  fs.mkdirSync(path.join(STORAGE_ROOT, id, "objects", "2020", "02"), { recursive: true });
  await sleep(400); // fire-and-forget request logs / usage land
  return { id, key, key2, files: f, openUpload: s2.uploadId, sessionIds: [s1.uploadId, s2.uploadId, s3.uploadId] };
}

async function dbCounts(pid, keyIds = []) {
  const projectId = new M.mongoose.Types.ObjectId(pid);
  return {
    project: await M.Project.countDocuments({ _id: projectId }),
    files: await M.FileObject.countDocuments({ projectId }),
    sessions: await M.UploadSession.countDocuments({ projectId }),
    keys: await M.ApiKey.countDocuments({ projectId }),
    usage: await M.UsageDaily.countDocuments({ $or: [{ projectId }, { refId: projectId }, ...(keyIds.length ? [{ refId: { $in: keyIds } }] : [])] }),
    logs: await M.RequestLog.countDocuments({ $or: [{ projectId }, ...(keyIds.length ? [{ apiKeyId: { $in: keyIds } }] : [])] }),
  };
}
function listFilesUnder(dir) {
  const out = [];
  const rec = (d) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      if (e.isDirectory()) rec(path.join(d, e.name));
      else out.push(path.join(d, e.name));
    }
  };
  rec(dir);
  return out;
}
const topLevelParts = () => (fs.existsSync(TMP_ROOT) ? fs.readdirSync(TMP_ROOT).filter((n) => n.endsWith(".part")) : []);
async function tempPathsOf(pid) {
  const rows = await M.UploadSession.find({ projectId: pid }).select("tmpObjId").lean();
  return rows.map((r) => path.join(CHUNK_DIR, `${r.tmpObjId}.part`));
}

/** Everything a deleted project must no longer have. Returns a list of problems. */
async function assertGone(fx, keyIds, tempPaths) {
  const problems = [];
  const c = await dbCounts(fx.id, keyIds);
  for (const [k, v] of Object.entries(c)) if (v) problems.push(`${k}=${v}`);
  if (fs.existsSync(path.join(STORAGE_ROOT, fx.id))) problems.push("data dir exists");
  if (fs.existsSync(path.join(TRASH_ROOT, fx.id))) problems.push("trash dir exists");
  const leftTemps = tempPaths.filter((p) => fs.existsSync(p));
  if (leftTemps.length) problems.push(`${leftTemps.length} chunk temp(s) left`);
  return problems;
}

async function controlSnapshot() {
  const files = await M.FileObject.find({ projectId: P.c }).lean();
  const p = await M.Project.findById(P.c).lean();
  return { files: files.map((f) => `${f.fileId}:${f.status}:${f.checksumSha256}`).sort().join(","), status: p.status, bytes: p.currentStorageBytes, count: p.fileCount, keys: await M.ApiKey.countDocuments({ projectId: P.c }) };
}

// ═════════════════════════ suite ═════════════════════════
async function suite() {
  // control project content
  const ctl = [];
  for (const n of ["keep1.bin", "keep2.bin"]) {
    const buf = detBuffer(2 * MiB, `ctl-${n}`);
    ctl.push({ ...(await apiUpload(K.c, n, buf)), sha: sha256(buf) });
  }
  const ctlBefore = await controlSnapshot();

  // ── the main test project, owned by A ──
  const A = await buildRichProject(U.a, C.a, TEST_NAME);
  P.a = A.id;
  const aKeyIds = await M.ApiKey.find({ projectId: A.id }).distinct("_id");
  const aTemps = await tempPathsOf(A.id);
  const aStored = (await M.FileObject.find({ projectId: A.id }).lean()).map((f) => ({ fileId: f.fileId, status: f.status, storageKey: f.storageKey }));
  let preview;

  await test("Fixture — test project has active, trashed, purged, chunked, keys, logs, usage, strays", async () => {
    const c = await dbCounts(A.id, aKeyIds);
    const onDisk = listFilesUnder(path.join(STORAGE_ROOT, A.id)).length + listFilesUnder(path.join(TRASH_ROOT, A.id)).length;
    const temps = aTemps.filter((p) => fs.existsSync(p)).length;
    assert(c.files === 8 && c.sessions === 3 && c.keys === 2 && c.logs > 10 && c.usage > 0, `unexpected fixture ${JSON.stringify(c)}`);
    assert(onDisk === 5 + 2 + 1 && temps === 1, `disk: ${onDisk} objects, ${temps} temps`);
    return `records ${JSON.stringify(c)}; ${onDisk} objects on disk (5 active + 2 trashed + 1 stray); 1 open-upload temp`;
  });

  await test("Preview (GET …/permanent) — real counts for the confirmation dialog", async () => {
    preview = expectOk(await call("GET", `/api/projects/${A.id}/permanent`, { cookie: C.a }));
    const c = preview.counts;
    const activeBytes = A.files.active.reduce((a, f) => a + f.size, 0);
    const trashedBytes = A.files.trashed.reduce((a, f) => a + f.size, 0);
    assert(c.activeFiles === 5 && c.activeBytes === activeBytes, `active ${c.activeFiles}/${c.activeBytes}`);
    assert(c.trashedFiles === 2 && c.trashedBytes === trashedBytes, `trashed ${c.trashedFiles}/${c.trashedBytes}`);
    assert(c.purgedRecords === 1 && c.apiKeys === 2 && c.activeApiKeys === 1 && c.uploadSessions === 3 && c.openUploads === 1 && c.openUploadBytes === 10 * MiB, JSON.stringify(c));
    assert(c.requestLogs > 0 && c.usageRows > 0, "logs/usage counted");
    assert(!JSON.stringify(preview).includes(WORK) && !JSON.stringify(preview).includes("storageKey"), "no path in preview");
    return JSON.stringify(c);
  });

  // ── authorization / verification — nothing may change ──
  const untouched = async () => {
    const p = await M.Project.findById(A.id).lean();
    assert(p && p.status === "active", `project status is ${p?.status}`);
    const c = await dbCounts(A.id, aKeyIds);
    assert(c.files === 8 && c.keys === 2 && c.sessions === 3, "records changed");
    expectOk(await call("GET", "/api/v1/files?limit=1", { key: A.key }));
  };
  await test("Unauthenticated DELETE → 401, nothing changed", async () => {
    expectErr(await call("DELETE", `/api/projects/${A.id}/permanent`, { json: { confirmName: TEST_NAME, acknowledge: true }, headers: { Origin: BASE } }), 401, "UNAUTHENTICATED");
    expectErr(await call("GET", `/api/projects/${A.id}/permanent`), 401, "UNAUTHENTICATED");
    await untouched();
  });
  await test("API key cannot delete (session-only route) → 401, nothing changed", async () => {
    expectErr(await call("DELETE", `/api/projects/${A.id}/permanent`, { key: A.key, json: { confirmName: TEST_NAME, acknowledge: true } }), 401, "UNAUTHENTICATED");
    await untouched();
  });
  await test("Another user (B) → 404 on preview and delete, nothing changed", async () => {
    expectErr(await call("GET", `/api/projects/${A.id}/permanent`, { cookie: C.b }), 404, "NOT_FOUND");
    expectErr(await call("DELETE", `/api/projects/${A.id}/permanent`, { cookie: C.b, json: { confirmName: TEST_NAME, acknowledge: true } }), 404, "NOT_FOUND");
    await untouched();
  });
  await test("CSRF — foreign Origin → 403, nothing changed", async () => {
    expectErr(await call("DELETE", `/api/projects/${A.id}/permanent`, { cookie: C.a, origin: "https://evil.example", json: { confirmName: TEST_NAME, acknowledge: true } }), 403, "CSRF_FAILED");
    await untouched();
  });
  await test("Wrong confirmation → 400 CONFIRMATION_MISMATCH, nothing changed", async () => {
    for (const confirmName of [TEST_NAME.toUpperCase(), ` ${TEST_NAME}`, `${TEST_NAME} `, TEST_NAME.slice(0, -1), "", null]) {
      expectErr(await call("DELETE", `/api/projects/${A.id}/permanent`, { cookie: C.a, json: { confirmName, acknowledge: true } }), 400, "CONFIRMATION_MISMATCH");
    }
    expectErr(await call("DELETE", `/api/projects/${A.id}/permanent`, { cookie: C.a, json: { confirmName: TEST_NAME } }), 400, "CONFIRMATION_MISMATCH");
    expectErr(await call("DELETE", `/api/projects/${A.id}/permanent`, { cookie: C.a, json: { confirmName: TEST_NAME, acknowledge: "yes" } }), 400, "CONFIRMATION_MISMATCH");
    expectErr(await call("DELETE", `/api/projects/${A.id}/permanent`, { cookie: C.a, body: "not json", headers: { "Content-Type": "application/json" } }), 400, "VALIDATION_ERROR");
    await untouched();
    return "case change, leading/trailing space, truncated, empty, null, missing/non-true acknowledge, bad JSON";
  });

  // ── the deletion ──
  let del;
  await test(`Owner deletes own project "${TEST_NAME}" → 200`, async () => {
    const t = Date.now();
    del = expectOk(await call("DELETE", `/api/projects/${A.id}/permanent`, { cookie: C.a, json: { confirmName: TEST_NAME, acknowledge: true } }));
    assert(del.deleted === true && del.projectId === A.id && del.name === TEST_NAME, "response shape");
    return `${Date.now() - t} ms; counts ${JSON.stringify(del.counts)}`;
  });
  await test("Deletion counts match what was there", async () => {
    const c = del.counts;
    assert(c.activeFiles === 5 && c.trashedFiles === 2 && c.purgedRecords === 1, "file records by status");
    assert(c.physicalRemoved === 7 && c.physicalAlreadyMissing === 0, `physical ${c.physicalRemoved}/${c.physicalAlreadyMissing}`);
    assert(c.strayFilesRemoved === 1, `stray ${c.strayFilesRemoved}`);
    assert(c.uploadsClosed === 1 && c.tempFilesRemoved === 1 && c.tempBytesRemoved === 10 * MiB, `uploads ${c.uploadsClosed}/${c.tempFilesRemoved}/${c.tempBytesRemoved}`);
    assert(c.fileRecords === 8 && c.uploadSessions === 3 && c.apiKeys === 2, `records ${c.fileRecords}/${c.uploadSessions}/${c.apiKeys}`);
    assert(c.requestLogs >= preview.counts.requestLogs && c.usageRows >= preview.counts.usageRows, "logs/usage");
    assert(del.audited === true, "audited");
  });
  await test("Active + trash physical files, strays and folders removed (no orphan folder)", async () => {
    assert(!fs.existsSync(path.join(STORAGE_ROOT, A.id)), "data/<projectId> still exists");
    assert(!fs.existsSync(path.join(TRASH_ROOT, A.id)), "trash/<projectId> still exists");
    for (const f of aStored) assert(!fs.existsSync(dataPath(f.storageKey)) && !fs.existsSync(trashPath(f.storageKey)), `object of ${f.fileId} remains`);
    return `${aStored.length} records' objects checked in data/ and trash/`;
  });
  await test("Temp/chunk files removed; no stray tmp/*.part", async () => {
    const left = aTemps.filter((p) => fs.existsSync(p));
    assert(!left.length, `${left.length} chunk temps remain`);
    assert(topLevelParts().length === 0, `tmp/*.part: ${topLevelParts().length}`);
  });
  await test("DB — project, FileObjects, UploadSessions, API keys, UsageDaily, RequestLogs all gone", async () => {
    await sleep(500); // any late fire-and-forget write would land by now
    const c = await dbCounts(A.id, aKeyIds);
    assert(Object.values(c).every((v) => v === 0), JSON.stringify(c));
    return JSON.stringify(c);
  });
  await test("Old API keys → 401 INVALID_API_KEY (both keys)", async () => {
    for (const k of [A.key, A.key2]) {
      expectErr(await call("GET", "/api/v1/files?limit=1", { key: k }), 401, "INVALID_API_KEY");
      expectErr(await call("GET", "/api/v1/keyinfo", { key: k }), 401, "INVALID_API_KEY");
      expectErr(await call("POST", "/api/v1/files", { key: k, body: Buffer.from("x"), headers: { "x-file-name": "x.bin", "Content-Type": "application/octet-stream" } }), 401, "INVALID_API_KEY");
    }
  });
  await test("Old File IDs unavailable — GET/HEAD/meta/download/Range, every plane", async () => {
    const ids = [...A.files.active, ...A.files.trashed].map((f) => f.fileId);
    for (const fid of ids) {
      expectErr(await call("GET", `/api/v1/files/${fid}`, { key: A.key }), 401, "INVALID_API_KEY");
      assert((await call("HEAD", `/api/v1/files/${fid}`, { key: A.key })).status === 401, "HEAD old key");
      expectErr(await call("GET", `/api/v1/files/${fid}/meta`, { key: A.key }), 401, "INVALID_API_KEY");
      expectErr(await call("GET", `/api/v1/files/${fid}/download`, { key: A.key, headers: { Range: "bytes=0-99" } }), 401, "INVALID_API_KEY");
      // a valid key of another project: the id resolves nowhere
      expectErr(await call("GET", `/api/v1/files/${fid}`, { key: K.c, headers: { Range: "bytes=0-99" } }), 404, "FILE_NOT_FOUND");
      assert((await call("HEAD", `/api/v1/files/${fid}`, { key: K.c })).status === 404, "HEAD other key");
      expectErr(await call("GET", `/api/v1/files/${fid}/meta`, { key: K.c }), 404, "FILE_NOT_FOUND");
      // the owner's dashboard session
      expectErr(await call("GET", `/api/dashboard/projects/${A.id}/files/${fid}`, { cookie: C.a }), 404, "NOT_FOUND");
      expectErr(await call("GET", `/api/dashboard/projects/${A.id}/files/${fid}/download`, { cookie: C.a }), 404, "NOT_FOUND");
      expectErr(await call("GET", `/api/dashboard/projects/${A.id}/files/${fid}/raw`, { cookie: C.a, headers: { Range: "bytes=0-99" } }), 404, "NOT_FOUND");
    }
    return `${ids.length} file ids × 10 requests`;
  });
  await test("Project gone from the dashboard (list + page) for owner and super-admin", async () => {
    for (const cookie of [C.a, C.s]) {
      const list = expectOk(await call("GET", "/api/projects", { cookie })).projects;
      assert(!list.some((p) => p.id === A.id), "still listed");
      expectErr(await call("GET", `/api/projects/${A.id}`, { cookie }), 404, "NOT_FOUND");
      expectErr(await call("GET", `/api/projects/${A.id}/permanent`, { cookie }), 404, "NOT_FOUND");
    }
    expectErr(await call("DELETE", `/api/projects/${A.id}/permanent`, { cookie: C.a, json: { confirmName: TEST_NAME, acknowledge: true } }), 404, "NOT_FOUND");
  });
  await test("Audit — PROJECT deletion entry kept (project.permanently_deleted), no secrets", async () => {
    const e = await M.AuditLog.findOne({ action: "project.permanently_deleted", targetId: A.id }).lean();
    assert(e, "no final audit entry");
    assert(e.actorLabel === U.a.email && String(e.actorUserId) === String(U.a._id), "actor");
    assert(e.details?.name === TEST_NAME && e.details?.projectId === A.id && e.details?.counts?.fileRecords === 8, "details");
    assert(await M.AuditLog.countDocuments({ action: "project.delete_started", targetId: A.id }) === 1, "start entry");
    const blob = JSON.stringify(await M.AuditLog.find({ targetId: A.id }).lean());
    for (const secret of [A.key, A.key2, A.key.split("_").pop(), JWT_SECRET, KEY_HASH_PEPPER]) assert(!blob.includes(secret), "secret in audit");
    assert(!blob.includes(WORK) && !blob.includes(STORAGE_ROOT) && !blob.includes("storageKey"), "path in audit");
    return `at ${e.ts.toISOString()} by ${e.actorLabel}; details keys: ${Object.keys(e.details).join(",")}`;
  });
  await test("Request log of the delete request itself: kept, not tied to the project", async () => {
    const rows = await M.RequestLog.find({ operation: "project.delete_permanent", status: 200 }).lean();
    assert(rows.length === 1 && rows[0].projectId == null && rows[0].actorLabel === U.a.email, `rows ${rows.length}`);
    assert(rows[0].requestId, "request id recorded");
  });

  // ── super-admin deletes a user's project; B's own attempt is refused first ──
  await test("Super-admin deletes a normal user's project → 200", async () => {
    const B = await buildRichProject(U.b, C.b, "zz-delete-project-test-b");
    P.b = B.id;
    const keyIds = await M.ApiKey.find({ projectId: B.id }).distinct("_id");
    const temps = await tempPathsOf(B.id);
    expectErr(await call("DELETE", `/api/projects/${B.id}/permanent`, { cookie: C.a, json: { confirmName: "zz-delete-project-test-b", acknowledge: true } }), 404, "NOT_FOUND");
    expectOk(await call("GET", "/api/v1/files?limit=1", { key: B.key })); // A's attempt changed nothing
    const d = expectOk(await call("DELETE", `/api/projects/${B.id}/permanent`, { cookie: C.s, json: { confirmName: "zz-delete-project-test-b", acknowledge: true } }));
    await sleep(500);
    const problems = await assertGone(B, keyIds, temps);
    assert(!problems.length, problems.join(", "));
    const list = expectOk(await call("GET", "/api/projects", { cookie: C.b })).projects;
    assert(!list.some((p) => p.id === B.id), "still in owner's list");
    const e = await M.AuditLog.findOne({ action: "project.permanently_deleted", targetId: B.id }).lean();
    assert(e?.actorLabel === U.s.email && e.details?.ownerId === String(U.b._id), "audit actor/owner");
    return `counts ${JSON.stringify(d.counts)}`;
  });

  // ── failure part-way → recoverable "deleting" state → retry ──
  await test("Failed stage → PROJECT_DELETE_FAILED, project stays 'deleting', locked down; retry completes", async () => {
    const F = await buildRichProject(U.a, C.a, "zz-delete-fail-test");
    const keyIds = await M.ApiKey.find({ projectId: F.id }).distinct("_id");
    const temps = await tempPathsOf(F.id);
    const t = await M.FileObject.findOne({ projectId: F.id, status: "trashed" }).lean();
    const locked = trashPath(t.storageKey);
    let firstCode = null;
    const lock = await lockExclusive(locked); // its delete now fails (sharing violation → EBUSY)
    try {
      const r = await call("DELETE", `/api/projects/${F.id}/permanent`, { cookie: C.a, json: { confirmName: "zz-delete-fail-test", acknowledge: true } });
      expectErr(r, 500, "PROJECT_DELETE_FAILED");
      firstCode = r.body.error.details?.errorCode;
      assert(r.body.error.details?.stage === "files" && ["EBUSY", "EPERM"].includes(r.body.error.details?.errorCode), `details ${JSON.stringify(r.body.error.details)}`);
      assert(!r.text.includes(WORK) && !r.text.includes(locked), "path in error response");
      const p = expectOk(await call("GET", `/api/projects/${F.id}`, { cookie: C.a })).project;
      assert(p.status === "deleting" && p.deletion?.stage === "files" && ["EBUSY", "EPERM"].includes(p.deletion?.lastErrorCode), `state ${p.status} ${JSON.stringify(p.deletion)}`);
      // locked down while "deleting"
      expectErr(await call("GET", "/api/v1/files?limit=1", { key: F.key }), 403, "PROJECT_DISABLED");
      expectErr(await call("POST", "/api/v1/files", { key: F.key, body: Buffer.from("x"), headers: { "x-file-name": "x.bin", "Content-Type": "application/octet-stream" } }), 403, "PROJECT_DISABLED");
      expectErr(await call("GET", `/api/dashboard/projects/${F.id}/files`, { cookie: C.a }), 409, "PROJECT_DELETING");
      expectErr(await call("POST", `/api/dashboard/projects/${F.id}/files`, { cookie: C.a, body: Buffer.from("x"), headers: { "x-file-name": "x.bin", "Content-Type": "application/octet-stream" } }), 409, "PROJECT_DELETING");
      expectErr(await call("POST", `${chunkBase(F.id)}?op=begin`, { cookie: C.a, json: { filename: "x.bin", size: 10 } }), 409, "PROJECT_DELETING");
      expectErr(await call("PATCH", `/api/projects/${F.id}`, { cookie: C.a, json: { status: "active" } }), 409, "PROJECT_DELETING");
      expectErr(await call("DELETE", `/api/projects/${F.id}`, { cookie: C.a }), 409, "PROJECT_DELETING");
      expectErr(await call("POST", `/api/projects/${F.id}/keys`, { cookie: C.a, json: { name: "late", scopes: ["files:read"] } }), 409, "PROJECT_DELETING");
      const k = await M.ApiKey.findOne({ projectId: F.id, status: "active" }).lean();
      if (k) expectErr(await call("POST", `/api/keys/${k._id}/rotate`, { cookie: C.a, json: {} }), 409, "PROJECT_DELETING");
      expectOk(await call("GET", `/api/projects/${F.id}/permanent`, { cookie: C.a })); // the retry dialog can still load counts
    } finally {
      await lock.release();
    }
    const d = expectOk(await call("DELETE", `/api/projects/${F.id}/permanent`, { cookie: C.a, json: { confirmName: "zz-delete-fail-test", acknowledge: true } }));
    await sleep(500);
    const problems = await assertGone(F, keyIds, temps);
    assert(!problems.length, problems.join(", "));
    const audit = await M.AuditLog.find({ targetId: F.id }).sort({ ts: 1 }).lean();
    const actions = audit.map((a) => a.action);
    assert(actions.includes("project.delete_failed") && actions.filter((a) => a === "project.delete_started").length === 2 && actions.at(-1) === "project.permanently_deleted", actions.join(" → "));
    assert(audit.at(-1).details.attempts === 2, "attempts");
    return `1st: stage files / ${firstCode}, locked down; retry: deleted (${JSON.stringify(d.counts)}); audit ${actions.join(" → ")}`;
  });

  // ── active transfers at the moment of deletion ──
  await test("Deletion while a download, a raw upload, a multipart upload and a chunk append are streaming", async () => {
    const R = await mkProject(U.a, "zz-delete-race-test", "race");
    const big = detBuffer(64 * MiB, "race-big");
    const bigMeta = await apiUpload(R.key, "big.bin", big);
    const open = await beginChunked(R.key, "open.bin", 20 * MiB, 10 * MiB);
    const partsBefore = topLevelParts().length;

    // An ABANDONED download first: the client reads a little and hangs up.
    await new Promise((resolve) => {
      const req = http.get(`${BASE}/api/v1/files/${bigMeta.fileId}`, { headers: { Authorization: `Bearer ${R.key}` } }, (res) => {
        res.once("data", () => { req.destroy(); resolve(); });
      });
      req.on("error", resolve);
    });
    const dl = await slowDownload(R.key, bigMeta.fileId);
    assert(dl.status === 200, `download status ${dl.status}`);
    const raw = trickleUpload({ pathQ: "/api/v1/files", headers: { Authorization: `Bearer ${R.key}`, "Content-Type": "application/octet-stream", "x-file-name": "raw.bin" }, prefix: detBuffer(2 * MiB, "raw"), total: 50 * MiB });
    const boundary = "----deltest" + crypto.randomBytes(6).toString("hex");
    const mp = trickleUpload({
      pathQ: `/api/dashboard/projects/${R.id}/files`,
      headers: { Cookie: C.a, Origin: BASE, "Content-Type": `multipart/form-data; boundary=${boundary}` },
      prefix: Buffer.concat([multipartPrefix(boundary, "mp.bin"), detBuffer(2 * MiB, "mp")]),
      total: 50 * MiB,
    });
    const chunkBuf = detBuffer(10 * MiB, "race-chunk");
    const ch = trickleUpload({ pathQ: `${apiChunk}?op=append&uploadId=${open.uploadId}&index=0`, headers: { Authorization: `Bearer ${R.key}`, "Content-Type": "application/octet-stream", "x-chunk-sha256": sha256(chunkBuf) }, prefix: chunkBuf.subarray(0, 3 * MiB), total: chunkBuf.length });
    await sleep(1500); // all four are mid-stream
    const midParts = topLevelParts().length - partsBefore;
    const openTemp = (await tempPathsOf(R.id))[0];
    assert(midParts === 2 && fs.existsSync(openTemp), `expected 2 upload .part files in flight, saw ${midParts}`);

    const t = Date.now();
    const d = expectOk(await call("DELETE", `/api/projects/${R.id}/permanent`, { cookie: C.a, json: { confirmName: "zz-delete-race-test", acknowledge: true } }));
    const took = Date.now() - t;
    const [rawR, mpR, chR] = await Promise.all([raw.result, mp.result, ch.result]);
    const dlR = await dl.drain();
    await sleep(500);
    const problems = await assertGone({ id: R.id }, [], [openTemp]);
    assert(!problems.length, problems.join(", "));
    assert(topLevelParts().length === partsBefore, `tmp/*.part left: ${topLevelParts().length - partsBefore}`);
    assert(dlR.bytes() < big.length && !dlR.ended, `download was not cut (${dlR.bytes()} bytes, ended=${dlR.ended})`);
    for (const [label, r] of [["raw", rawR], ["multipart", mpR], ["chunk", chR]]) {
      assert(r.status !== 200 && r.status !== 201, `${label} upload succeeded (${r.status})`);
    }
    assert(d.counts.transfersCancelled >= 3, `transfersCancelled ${d.counts.transfersCancelled}`);
    raw.destroy(); mp.destroy(); ch.destroy();
    return `deleted in ${took} ms; cancelled ${d.counts.transfersCancelled} transfers + ${d.counts.chunksAborted} chunk append; download cut at ${(dlR.bytes() / MiB).toFixed(1)} MiB of 64 (${dlR.error || "closed"}); raw ${rawR.status || rawR.reset} ${rawR.code || ""}; multipart ${mpR.status || mpR.reset} ${mpR.code || ""}; chunk ${chR.status || chR.reset} ${chR.code || ""}`;
  });

  await test("Two deletes at once → exactly one runs; the other is refused cleanly", async () => {
    const D = await mkProject(U.a, "zz-delete-double-test", "dbl");
    for (let i = 0; i < 20; i++) await apiUpload(D.key, `f${i}.bin`, detBuffer(256 * 1024, `dbl-${i}`));
    const body = { confirmName: "zz-delete-double-test", acknowledge: true };
    const rs = await Promise.all([call("DELETE", `/api/projects/${D.id}/permanent`, { cookie: C.a, json: body }), call("DELETE", `/api/projects/${D.id}/permanent`, { cookie: C.s, json: body })]);
    const oks = rs.filter((r) => r.status === 200).length;
    const others = rs.filter((r) => r.status !== 200).map((r) => r.body?.error?.code);
    assert(oks === 1 && others.every((c) => c === "PROJECT_DELETE_IN_PROGRESS" || c === "NOT_FOUND"), `statuses ${rs.map((r) => `${r.status} ${r.body?.error?.code || ""}`).join(", ")}`);
    await sleep(300);
    const problems = await assertGone({ id: D.id }, [], []);
    assert(!problems.length, problems.join(", "));
    return `second request: ${others.join(",")}`;
  });

  // ── nothing else changed ──
  await test("Control project untouched: records, counters, key, bytes (SHA)", async () => {
    const now = await controlSnapshot();
    assert(JSON.stringify(now) === JSON.stringify(ctlBefore), `changed: ${JSON.stringify(ctlBefore)} → ${JSON.stringify(now)}`);
    for (const f of ctl) {
      const res = await fetch(`${BASE}/api/v1/files/${f.fileId}`, { headers: { Authorization: `Bearer ${K.c}` } });
      assert(res.status === 200, `download ${res.status}`);
      assert(sha256(Buffer.from(await res.arrayBuffer())) === f.sha, "sha mismatch");
    }
  });
  await test("Other delete behaviour unchanged: trash, restore, purge, disable, archive, enable", async () => {
    const buf = detBuffer(512 * 1024, "reg");
    const up = await apiUpload(K.c, "reg.bin", buf);
    expectOk(await call("DELETE", `/api/v1/files/${up.fileId}`, { key: K.c }));
    expectOk(await call("POST", `/api/dashboard/projects/${P.c}/files/${up.fileId}/restore`, { cookie: C.a, json: {} }));
    expectOk(await call("GET", `/api/v1/files/${up.fileId}/meta`, { key: K.c }));
    expectOk(await call("DELETE", `/api/dashboard/projects/${P.c}/files/${up.fileId}`, { cookie: C.a }));
    expectOk(await call("DELETE", `/api/dashboard/projects/${P.c}/files/${up.fileId}/purge`, { cookie: C.a }));
    expectOk(await call("PATCH", `/api/projects/${P.c}`, { cookie: C.a, json: { status: "disabled" } }));
    expectErr(await call("GET", "/api/v1/files?limit=1", { key: K.c }), 403, "PROJECT_DISABLED");
    expectOk(await call("DELETE", `/api/projects/${P.c}`, { cookie: C.a })); // archive
    assert((await M.Project.findById(P.c).lean()).status === "archived", "archived");
    expectOk(await call("PATCH", `/api/projects/${P.c}`, { cookie: C.a, json: { status: "active" } }));
    expectOk(await call("GET", "/api/v1/files?limit=1", { key: K.c }));
    expectErr(await call("PATCH", `/api/projects/${P.c}`, { cookie: C.a, json: { status: "deleting" } }), 400, "VALIDATION_ERROR");
    return "trash → restore → trash → purge; disable → archive → enable; status 'deleting' cannot be set by PATCH";
  });

  await test("Final integrity scan (full, with SHA) + usage reconcile → 0 problems", async () => {
    const r = await M.integrity.runIntegrityCheck({ full: true });
    assert(r.problemCount === 0, JSON.stringify(r.problems.slice(0, 5)));
    const rec = await M.reconcile.reconcileAll();
    assert(rec.every((x) => x.inSync), JSON.stringify(rec.filter((x) => !x.inSync)));
    const projectDirs = fs.existsSync(STORAGE_ROOT) ? fs.readdirSync(STORAGE_ROOT) : [];
    const trashDirs = fs.existsSync(TRASH_ROOT) ? fs.readdirSync(TRASH_ROOT) : [];
    const live = new Set((await M.Project.find({}).select("_id").lean()).map((p) => String(p._id)));
    const orphanDirs = [...projectDirs, ...trashDirs].filter((d) => !live.has(d));
    assert(!orphanDirs.length, `orphan project dirs: ${orphanDirs.length}`);
    const liveTemps = new Set((await M.UploadSession.find({}).select("tmpObjId").lean()).map((s) => `${s.tmpObjId}.part`));
    const orphanTemps = (fs.existsSync(CHUNK_DIR) ? fs.readdirSync(CHUNK_DIR) : []).filter((n) => !liveTemps.has(n));
    assert(!orphanTemps.length, `orphan chunk temps: ${orphanTemps.length}`);
    return `${r.checked} objects checked, ${r.healthy} healthy; ${rec.length} project(s) in sync; 0 orphan project dirs; 0 orphan chunk temps`;
  });
}

// ═════════════════════════ serve (browser test) ═════════════════════════
async function serveMode() {
  const { hashPassword } = await import("@/lib/auth/password");
  const pw = "Tst-" + crypto.randomBytes(12).toString("base64url") + "9!";
  await M.User.updateOne({ _id: U.a._id }, { $set: { passwordHash: await hashPassword(pw), mustChangePassword: false } });
  await startServer();
  const A = await buildRichProject(U.a, C.a, TEST_NAME);
  const credFile = path.join(WORK, "test-credentials.json");
  fs.writeFileSync(credFile, JSON.stringify({ url: BASE, email: U.a.email, password: pw, projectId: A.id, controlProjectId: P.c, storageRoot: STORAGE_ROOT, mongoUri: MONGO_URI }, null, 2));
  console.log(`SERVING ${BASE} — test project ${A.id} — credentials in ${credFile}`);
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
  await startServer();
  await suite();

  await test("Security — no path / storage key / temp id in any API response", async () => {
    const blob = captured.join("\n");
    const tmpIds = (await M.UploadSession.find({}).select("tmpObjId").lean()).map((s) => s.tmpObjId);
    assert(!blob.includes(WORK) && !blob.includes(WORK.replace(/\\/g, "\\\\")) && !blob.includes("storageKey") && !blob.includes("tmpObjId") && !blob.includes(".part"), "path leaked");
    assert(!tmpIds.some((t) => blob.includes(t)), "temp id leaked");
    return `${captured.length} responses scanned`;
  });
  await stopServer();
  await test("Security — server logs: no absolute paths, no secrets", async () => {
    const files = fs.readdirSync(WORK).filter((f) => /^server-.*\.log$/.test(f));
    const logs = files.map((f) => fs.readFileSync(path.join(WORK, f), "utf8")).join("\n");
    const lower = logs.toLowerCase();
    const forms = (p) => [p, p.replace(/\\/g, "/"), p.replace(/\\/g, "\\\\")].map((v) => v.toLowerCase());
    const leaks = [];
    for (const [label, p] of [["work dir", WORK], ["app dir", ROOT], ["storage root", STORAGE_ROOT], ["temp dir", os.tmpdir()], ["home dir", os.homedir()]]) {
      if (forms(path.resolve(p)).some((v) => lower.includes(v))) leaks.push(label);
    }
    if (/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s'"]*/.test(logs)) leaks.push("a drive-letter path");
    for (const [label, v] of [["JWT secret", JWT_SECRET], ["key pepper", KEY_HASH_PEPPER], ...Object.entries(C).map(([k, v]) => [`cookie ${k}`, v.slice(v.indexOf("=") + 1)])]) {
      if (v && logs.includes(v)) leaks.push(label);
    }
    if (/gsk_(live|test)_[A-Za-z0-9]{12}_[A-Za-z0-9]{40}/.test(logs)) leaks.push("an API key");
    if (/\bBearer\s+[A-Za-z0-9]/.test(logs)) leaks.push("an Authorization header");
    assert(!leaks.length, `found in server logs: ${leaks.join(", ")}`);
    const failLine = logs.split("\n").find((l) => l.includes("[project.delete]"));
    assert(failLine && /stage=files/.test(failLine) && /EBUSY|EPERM/.test(failLine), "the failed stage was logged (path-free)");
    return `${files.length} server log(s); failure line: ${failLine.trim().slice(0, 160)}`;
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
fs.writeFileSync(path.join(WORK, "results.json"), JSON.stringify({ mode: PROD ? "production" : "dev", results, serverStarts: serverRun, devRouteRestarts }, null, 2));
console.log(`results: ${path.join(WORK, "results.json")}`);
if (!process.env.TEST_KEEP) await fsp.rm(WORK, { recursive: true, force: true }).catch(() => {});
process.exit(exitCode || (failed.length ? 1 : 0));
