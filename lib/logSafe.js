// lib/logSafe.js
// Server-console output that never carries absolute filesystem paths or secrets.
//
// Node's fs errors put absolute paths in .message ("EBUSY: resource busy or
// locked, rename 'D:\GravStorage\tmp\…' -> 'D:\GravStorage\data\…'") and in
// .path/.dest, and every stack frame names a file under the app directory. Log
// lines here carry identifiers (projectId, uploadId, fileId), the operation and
// the error code instead, and whatever path is still inside a message is
// rewritten relative to a named root:
//   <storage>  the storage base — STORAGE_ROOT's parent (data/, tmp/, trash/)
//   <app>      this application's directory (process.cwd())
//   <tmp>      the OS temp directory        <home>  the user's home directory
// Anything else absolute becomes <path>. The relative remainder is kept on
// purpose — "<storage>\tmp\chunked\….part" still says WHICH step failed.
//
// installConsoleRedaction() applies the same rewrite to every console line of a
// production server (instrumentation.js), so Next.js's own error output and any
// route that is not wrapped are covered too.

import os from "os";
import path from "path";
import util from "util";
import config from "@/lib/config";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A separator as it appears in logs: "\" or "/", or "\\" inside util.inspect /
// JSON output.
const SEP = String.raw`(?:\\{1,2}|/)`;

function rootPattern(root) {
  const parts = root.split(/[\\/]+/).filter(Boolean).map(escapeRe);
  const lead = root.startsWith("/") ? SEP : ""; // POSIX roots start at "/"
  return new RegExp(lead + parts.join(SEP) + String.raw`(?=$|[\\/'"\s:),\]])`, process.platform === "win32" ? "gi" : "g");
}

let roots = null;
function rootRules() {
  if (roots) return roots;
  const safe = (fn) => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
  roots = [
    ["<storage>", safe(() => path.dirname(path.resolve(config.storageRoot)))],
    ["<app>", safe(() => process.cwd())],
    ["<tmp>", safe(() => os.tmpdir())],
    ["<home>", safe(() => os.homedir())],
  ]
    // Never a bare drive or "/" — that would swallow unrelated text.
    .filter(([, p]) => p && p.replace(/[\\/]+$/, "").length > 3)
    // Longest first: <tmp> usually lives under <home>.
    .sort((a, b) => b[1].length - a[1].length)
    .map(([label, p]) => [label, rootPattern(path.resolve(p))]);
  return roots;
}

const WIN_ABS = /(?<![A-Za-z0-9])[A-Za-z]:(?:\\{1,2}|\/)[^\s'"`<>|(),]*/g; // D:\x, D:/x, D:\\x
const UNC = /(?<![\\\w>])\\\\[^\\\s'"`<>|(),]+\\[^\s'"`<>|(),]*/g; // \\server\share\x (not "<storage>\\x")
const POSIX_QUOTED = /(['"`])\/(?!\/)[^'"`\n]*\1/g; // '/var/data/x'
const POSIX_FRAME = /(\(|\bat )\/(?!\/)[^\s():]+(?=:\d)/g; // (/app/x.js:1:2)
const SECRETS = [
  [/(mongodb(?:\+srv)?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1<credentials>@"],
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, "$1<redacted>"],
  [/(\bgs_session=)[^;\s'"]+/g, "$1<redacted>"],
  [/(\bgsk_(?:live|test)_[A-Za-z0-9]{12})_[A-Za-z0-9]{40}\b/g, "$1_<redacted>"],
];

/** Rewrite absolute paths (and credential-looking values) inside any text. */
export function redact(text) {
  let s = String(text ?? "");
  for (const [label, re] of rootRules()) s = s.replace(re, label);
  s = s.replace(WIN_ABS, "<path>").replace(UNC, "<path>");
  // On a POSIX host a quoted "/x/y" could also be a route path ('/api/v1/files'),
  // so these two only run there; on Windows every real path has a drive or UNC.
  if (process.platform !== "win32") s = s.replace(POSIX_QUOTED, "$1<path>$1").replace(POSIX_FRAME, "$1<path>");
  for (const [re, to] of SECRETS) s = s.replace(re, to);
  return s;
}

/** One path-free line for an error: code, syscall, message. No stack. */
export function describeError(e) {
  if (e == null) return "unknown error";
  if (typeof e !== "object") return redact(String(e));
  const code = e.code != null ? String(e.code) : e.name || "Error";
  let msg = String(e.message ?? "");
  if (msg.startsWith(`${code}: `)) msg = msg.slice(code.length + 2); // fs: "EBUSY: resource busy…"
  return redact(`${code}${e.syscall ? ` ${e.syscall}` : ""}: ${msg}`);
}

/**
 * console.error one failure as `[op] id=… id=… CODE syscall: message`.
 * `ids` holds identifiers only (projectId, uploadId, fileId, …) — never paths.
 */
export function logError(op, ids, e) {
  const tags = Object.entries(ids || {})
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => ` ${k}=${v}`)
    .join("");
  console.error(redact(`[${op}]${tags} ${describeError(e)}`));
}

/**
 * Route every console line of this process through redact(). Formats the
 * arguments exactly as console would (util.format), then rewrites the text.
 */
export function installConsoleRedaction() {
  if (globalThis.__gsConsoleRedaction) return;
  globalThis.__gsConsoleRedaction = true;
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level];
    if (typeof original !== "function") continue;
    console[level] = (...args) => original.call(console, redact(util.format(...args)));
  }
}
