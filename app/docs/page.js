"use client";
// Grav Storage — public documentation center. 3-column docs experience:
// left nav · reading column · "On this page" TOC · client-side search (⌘K).
// Content verified against the implementation (routes, lib/http.js, lib/config.js).
import { useEffect, useMemo, useRef, useState } from "react";
import CodeBlock from "@/components/CodeBlock";
import Icon from "@/components/icons";

const NAV = [
  ["Getting Started", [["intro", "Introduction"], ["quickstart", "Quick Start"], ["security", "Security"], ["auth", "Authentication"], ["keys", "API Keys"]]],
  ["Concepts", [["files-model", "The File Model"], ["folders", "Folders & Metadata"], ["usage", "Usage & Quotas"], ["limits", "Rate Limits"], ["errors", "Errors"]]],
  ["Files API", [["api-auth", "Base URL & Auth"], ["api-upload", "Upload"], ["api-chunked", "Chunked Upload"], ["api-get", "Retrieve & Download"], ["api-range", "Range Requests"], ["api-meta", "Metadata"], ["api-list", "List"], ["api-delete", "Delete"], ["api-usage", "Usage & Key Info"]]],
  ["SDK", [["sdk-install", "Installation"], ["sdk-ref", "SDK Reference"]]],
  ["Examples", [["ex-node", "Node.js"], ["ex-curl", "cURL"], ["ex-ps", "PowerShell"], ["ex-cms", "GRAV CMS Pattern"]]],
  ["Operations", [["deploy", "Deployment"], ["backup", "Backup & Restore"], ["maintenance", "Maintenance"]]],
];
const FLAT = NAV.flatMap(([g, items]) => items.map(([id, label]) => ({ id, label, group: g })));
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default function DocsPage() {
  const [active, setActive] = useState("intro");
  const [q, setQ] = useState("");
  const [showRes, setShowRes] = useState(false);
  const [sel, setSel] = useState(0);
  const [sideOpen, setSideOpen] = useState(false);
  const [toc, setToc] = useState([]);
  const [activeH, setActiveH] = useState("");
  const articleRef = useRef(null);
  const searchRef = useRef(null);

  const go = (id) => { setActive(id); setSideOpen(false); setShowRes(false); setQ(""); window.history.replaceState(null, "", `#${id}`); window.scrollTo(0, 0); };

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id && FLAT.some((x) => x.id === id)) setActive(id);
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "Escape") { setShowRes(false); searchRef.current?.blur(); }
    };
    const onHash = () => { const h = window.location.hash.slice(1); if (FLAT.some((x) => x.id === h)) { setActive(h); window.scrollTo(0, 0); } };
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHash);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("hashchange", onHash); };
  }, []);

  // Build "On this page" TOC + scroll-spy from the rendered article headings.
  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;
    const heads = [...el.querySelectorAll("h2, h3")];
    const items = heads.map((h) => { const id = h.id || slug(h.textContent); h.id = id; return { id, text: h.textContent, level: h.tagName === "H3" ? 3 : 2 }; });
    setToc(items);
    setActiveH(items[0]?.id || "");
    if (!heads.length) return;
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActiveH(vis[0].target.id);
    }, { rootMargin: "-72px 0px -72% 0px", threshold: 0 });
    heads.forEach((h) => obs.observe(h));
    return () => obs.disconnect();
  }, [active]);

  const results = useMemo(() => (q.trim() ? FLAT.filter((x) => (x.label + " " + x.group).toLowerCase().includes(q.toLowerCase())).slice(0, 8) : []), [q]);
  function onSearchKey(e) {
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % results.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + results.length) % results.length); }
    else if (e.key === "Enter") { e.preventDefault(); go(results[sel]?.id || results[0].id); }
  }

  return (
    <>
      <header className="docs-header">
        <button className="btn btn-icon btn-subtle btn-sm docs-side-toggle" aria-label="Menu" onClick={() => setSideOpen(true)}><Icon name="menu" /></button>
        <a href="/" className="brand"><span className="gs-logo" style={{ width: 24, height: 24, fontSize: 13 }}>G</span> Grav Storage <span className="sep">/</span> <span className="docs-word">Docs</span></a>
        <div className="docs-search">
          <Icon name="search" size={15} className="s-ico" />
          <input ref={searchRef} value={q} placeholder="Search documentation…"
            onChange={(e) => { setQ(e.target.value); setSel(0); setShowRes(true); }}
            onFocus={() => setShowRes(true)} onBlur={() => setTimeout(() => setShowRes(false), 150)} onKeyDown={onSearchKey} />
          <kbd className="s-kbd">⌘K</kbd>
          {showRes && q.trim() && (
            <div className="docs-search-results">
              {results.length ? results.map((r, i) => (
                <a key={r.id} className={i === sel ? "on" : ""} onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); go(r.id); }}>
                  <span>{r.label}</span><span className="r-grp">{r.group}</span>
                </a>
              )) : <div className="docs-search-empty">No results for “{q}”</div>}
            </div>
          )}
        </div>
        <span className="spacer" />
        <a href="/dashboard" className="btn btn-ghost btn-sm">Dashboard</a>
        <a href="/login" className="btn btn-primary btn-sm">Sign in</a>
      </header>

      <div className={`docs-side-backdrop ${sideOpen ? "open" : ""}`} onClick={() => setSideOpen(false)} />
      <div className="docs-layout">
        <nav className={`docs-side ${sideOpen ? "open" : ""}`}>
          {NAV.map(([group, items]) => (
            <div key={group}>
              <div className="grp">{group}</div>
              {items.map(([id, label]) => (
                <a key={id} className={active === id ? "on" : ""} onClick={() => go(id)}>{label}</a>
              ))}
            </div>
          ))}
        </nav>

        <main className="docs-article">
          <div ref={articleRef}>
            {SECTIONS[active] ? SECTIONS[active]() : SECTIONS.intro()}
          </div>
          <hr className="hr" style={{ marginTop: 40 }} />
          <p className="muted small">Grav Storage · self-hosted object storage · API v1</p>
        </main>

        <aside className="docs-toc">
          {toc.length > 0 && <>
            <div className="toc-title">On this page</div>
            {toc.map((t) => (
              <a key={t.id} className={`${activeH === t.id ? "on" : ""} ${t.level === 3 ? "lvl3" : ""}`}
                onClick={() => document.getElementById(t.id)?.scrollIntoView({ behavior: "smooth" })}>{t.text}</a>
            ))}
          </>}
        </aside>
      </div>
    </>
  );
}

const SECTIONS = {
  intro: () => (
    <div>
      <h1>Grav Storage</h1>
      <p className="docs-lede">A self-hosted object-storage service for the GRAV projects. Upload files over a streaming HTTP API, get back an opaque <code>fileId</code>, and retrieve, range-read, or download them later — with per-project quotas, usage tracking and API-key access control.</p>
      <div className="callout danger">
        <b>API keys are server-side secrets.</b> Never put a key in browser JavaScript, a <code>NEXT_PUBLIC_*</code> variable, or a public repo. Your browser talks to <i>your</i> backend; only your backend holds the key and talks to Grav Storage. See <a onClick={() => location.hash = "security"}>Security</a>.
      </div>
      <h2>How it works</h2>
      <ul>
        <li>Create a <b>project</b> (an isolation boundary: its own files, quota and keys).</li>
        <li>Mint an <b>API key</b> for that project with least-privilege <b>scopes</b>.</li>
        <li>Your backend calls the <b>v1 API</b> (or the <b>SDK</b>) with <code>Authorization: Bearer gsk_…</code>.</li>
        <li>Uploads <b>stream</b> to disk while a SHA-256 checksum is computed in the same pass — a 900 MB file never sits in memory.</li>
        <li>You store the returned <code>fileId</code> in your own database and use it to retrieve the file later.</li>
      </ul>
      <h2>Two planes</h2>
      <p>The <b>machine plane</b> (<code>/api/v1/*</code>) is authenticated with an API key and is what your services use. The <b>dashboard plane</b> (this web app) is authenticated with a session cookie and is for humans managing projects, keys and files. Both share one storage engine.</p>
    </div>
  ),

  quickstart: () => (
    <div>
      <h1>Quick start</h1>
      <p className="docs-lede">From zero to your first upload in a few minutes.</p>
      <h3>1. Configure your backend</h3>
      <p>Put these in your <b>server-side</b> environment (e.g. <code>.env</code>). The key is read by your backend only — never shipped to the browser.</p>
      <CodeBlock lang="env">{`# your app's server-side .env  (NOT committed, NOT NEXT_PUBLIC_*)
GRAV_STORAGE_URL=http://localhost:4000
GRAV_STORAGE_API_KEY=gsk_live_xxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</CodeBlock>
      <h3>2. Install the SDK</h3>
      <CodeBlock lang="bash">{`npm install file:../grav-storage/packages/grav-storage-sdk`}</CodeBlock>
      <h3>3. Upload a file and store the fileId</h3>
      <CodeBlock lang="node">{`import { GravStorage } from "@grav/storage-sdk";

const storage = new GravStorage({
  baseUrl: process.env.GRAV_STORAGE_URL,
  apiKey: process.env.GRAV_STORAGE_API_KEY, // server-side only
});

// Stream an upload (a path, a Buffer, or any Node Readable)
const file = await storage.files.upload("./invoice.pdf");
console.log(file.fileId); // e.g. "file_DgJOyCOxCgDffshF9xaFV3jw"

// ✅ Save file.fileId in YOUR database.
// ❌ Do NOT store a filesystem path — the physical location is private and
//    may change. The fileId is the only stable, public handle to the object.`}</CodeBlock>
      <h3>4. Retrieve it later</h3>
      <CodeBlock lang="node">{`const meta = await storage.files.meta(file.fileId);   // { name, sizeBytes, mimeType, ... }
await storage.files.download(file.fileId, "./out.pdf"); // streams to disk`}</CodeBlock>
      <div className="callout info">New to the platform? Create a project and an API key from the <a href="/dashboard">Dashboard</a>, then copy the key (shown once) into your <code>.env</code>.</div>
    </div>
  ),

  security: () => (
    <div>
      <h1>Security</h1>
      <div className="callout danger">
        <b>The API key grants full access to a project.</b> Treat it like a password. If it leaks, revoke it immediately from the dashboard and rotate to a new one.
      </div>
      <h2>Never expose the key to the browser</h2>
      <ul>
        <li>Do <b>not</b> set <code>NEXT_PUBLIC_GRAV_STORAGE_API_KEY</code> or any client-visible variable.</li>
        <li>Do <b>not</b> call <code>/api/v1/*</code> directly from front-end code.</li>
        <li>Do <b>not</b> commit keys. The raw secret is shown <b>once</b> at creation and never stored or logged by Grav Storage (only a prefix + a salted hash are kept).</li>
      </ul>
      <h3>Correct request flow</h3>
      <CodeBlock>{`Browser  ──(multipart / JSON to YOUR route)──▶  Your backend  ──(SDK, holds key)──▶  Grav Storage
   ▲                                                     │
   └───────────────( file, or a fileId )─────────────────┘`}</CodeBlock>
      <p>The browser uploads to <i>your</i> server; your server streams it on to Grav Storage with the key and returns a <code>fileId</code>. To show a file, your server streams it back (or issues a short-lived link from your own app) — the key and the storage URL stay private.</p>
      <h2>Least privilege</h2>
      <ul>
        <li>Give each key only the scopes it needs (<code>files:read</code>, <code>files:write</code>, <code>files:list</code>, <code>files:delete</code>).</li>
        <li>Use separate <code>live</code> and <code>test</code> keys, and a separate project per application.</li>
        <li>Rotate keys periodically; the rotate flow mints a new key while the old one keeps working until you revoke it.</li>
      </ul>
      <h2>What the server enforces</h2>
      <ul>
        <li><b>CSRF</b> — session (cookie) mutations require a same-origin <code>Origin</code>/<code>Referer</code>. The Bearer API plane is exempt (no ambient cookies → no CSRF vector).</li>
        <li><b>No permissive CORS</b> — the API is not readable cross-origin from a browser, which keeps keys out of front-end code by construction.</li>
        <li><b>Project isolation</b> — a key can only ever see its own project's files.</li>
        <li><b>Integrity</b> — every upload is checksummed (SHA-256); the checksum is returned so you can verify round-trips.</li>
      </ul>
    </div>
  ),

  auth: () => (
    <div>
      <h1>Authentication</h1>
      <p>Every <code>/api/v1</code> request must carry an API key as a Bearer token:</p>
      <CodeBlock lang="http">{`Authorization: Bearer gsk_live_<lookupId>_<secret>`}</CodeBlock>
      <p>Keys look like <code>gsk_live_…</code> or <code>gsk_test_…</code>. The server checks credential → rate limit → project status → scope, so failures return a precise code.</p>
      <table className="table" style={{ marginTop: 10 }}>
        <thead><tr><th>Situation</th><th>Code</th><th>HTTP</th></tr></thead>
        <tbody>
          <tr><td>No <code>Authorization</code> header</td><td className="mono">MISSING_API_KEY</td><td>401</td></tr>
          <tr><td>Unknown / malformed key</td><td className="mono">INVALID_API_KEY</td><td>401</td></tr>
          <tr><td>Key was revoked</td><td className="mono">API_KEY_REVOKED</td><td>401</td></tr>
          <tr><td>Project archived/disabled, or its permanent deletion has started</td><td className="mono">PROJECT_DISABLED</td><td>403</td></tr>
          <tr><td>Key lacks the required scope</td><td className="mono">INSUFFICIENT_SCOPE</td><td>403</td></tr>
          <tr><td>Too many requests</td><td className="mono">RATE_LIMIT_EXCEEDED</td><td>429</td></tr>
        </tbody>
      </table>
      <p className="muted small" style={{ marginTop: 10 }}>Verify a key quickly with <code>GET /api/v1/keyinfo</code> (requires <code>files:read</code>).</p>
      <p className="muted small">Once a project is <b>permanently deleted</b> (dashboard → Settings → Danger zone) its keys are gone: they return <code>INVALID_API_KEY</code>, and its file IDs resolve nowhere (<code>FILE_NOT_FOUND</code> with any other project&apos;s key).</p>
    </div>
  ),

  keys: () => (
    <div>
      <h1>API keys &amp; scopes</h1>
      <p>Create keys per project from the dashboard. The raw secret is displayed <b>once</b>; store it immediately in your backend config.</p>
      <h3>Scopes</h3>
      <table className="table">
        <thead><tr><th>Scope</th><th>Grants</th></tr></thead>
        <tbody>
          <tr><td className="mono">files:write</td><td>Upload new files</td></tr>
          <tr><td className="mono">files:read</td><td>Download / stream / metadata / key info / usage</td></tr>
          <tr><td className="mono">files:list</td><td>List files in the project</td></tr>
          <tr><td className="mono">files:delete</td><td>Move files to trash</td></tr>
        </tbody>
      </table>
      <h3>Environments</h3>
      <p><code>live</code> and <code>test</code> keys are independent; use <code>test</code> for staging/CI. Both work against the same API — the label helps you keep them apart.</p>
      <h3>Rotation &amp; revocation</h3>
      <ul>
        <li><b>Rotate</b> mints a new key (same scopes/env) and returns its secret once; the old key stays <i>active</i> so a running deploy keeps working. Revoke the old one after cutover.</li>
        <li><b>Revoke</b> disables a key immediately and permanently. Historical usage is retained.</li>
        <li>Only a <i>revoked</i> key can be deleted (so a live integration can't be destroyed by accident).</li>
      </ul>
    </div>
  ),

  "files-model": () => (
    <div>
      <h1>The file model</h1>
      <p>Every object has an opaque, stable <code>fileId</code> (e.g. <code>file_DgJOyCOxCgDffshF9xaFV3jw</code>). That id is the public contract — <b>store it, not a path</b>. The physical location on disk is private and never exposed.</p>
      <h3>Metadata fields</h3>
      <p>Returned by <code>meta</code>, <code>list</code> and the SDK:</p>
      <table className="table">
        <thead><tr><th>Field</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td className="mono">fileId</td><td>Opaque public id — the only handle you persist</td></tr>
          <tr><td className="mono">name</td><td>Original filename</td></tr>
          <tr><td className="mono">mimeType</td><td>Resolved content type</td></tr>
          <tr><td className="mono">extension</td><td>Lower-cased extension</td></tr>
          <tr><td className="mono">sizeBytes</td><td>Exact size on disk</td></tr>
          <tr><td className="mono">checksumSha256</td><td>SHA-256 computed during upload</td></tr>
          <tr><td className="mono">status</td><td><code>active</code> or <code>trashed</code></td></tr>
          <tr><td className="mono">folderPath / tags / metadata</td><td>Your organizational fields (see next section)</td></tr>
          <tr><td className="mono">downloads / bytesServed</td><td>Per-file historical counters</td></tr>
          <tr><td className="mono">createdAt / updatedAt / trashedAt</td><td>Timestamps (ISO)</td></tr>
        </tbody>
      </table>
    </div>
  ),

  folders: () => (
    <div>
      <h1>Folders, tags &amp; metadata</h1>
      <p>Files are organized with optional, purely logical fields — there are no real directories on disk.</p>
      <ul>
        <li><b>folderPath</b> — a slash path like <code>invoices/2026</code>. Sent as the <code>folderPath</code> field (multipart) or filtered in <code>list</code> with <code>?folder=invoices/2026</code>.</li>
        <li><b>tags</b> — a comma-separated list (max 20), e.g. <code>tags=paid,q1</code>.</li>
        <li><b>metadata</b> — a small JSON object of your own key/values, returned as-is.</li>
      </ul>
      <p className="muted small">Folders and tags are set at upload time via multipart fields. They never change the object's identity — the <code>fileId</code> stays the same.</p>
    </div>
  ),

  usage: () => (
    <div>
      <h1>Usage &amp; quotas</h1>
      <p>Two very different numbers are tracked per project — don't confuse them:</p>
      <table className="table">
        <thead><tr><th>Metric</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td className="mono">currentStorageBytes</td><td><b>Live</b> bytes of active files on disk. Goes <i>down</i> when files are trashed/purged. Quota is enforced against this.</td></tr>
          <tr><td className="mono">bytesUploaded / bytesDownloaded</td><td><b>Historical</b> bandwidth totals. Only ever increase.</td></tr>
          <tr><td className="mono">fileCount</td><td>Active files now.</td></tr>
          <tr><td className="mono">uploads / downloads / requests</td><td>Lifetime operation counts.</td></tr>
        </tbody>
      </table>
      <h3>Quotas</h3>
      <p>A project may have a storage quota (bytes) or be unlimited. Uploads are gated <b>atomically</b>: two concurrent uploads can never race past the quota — exactly one succeeds and the other gets <code>STORAGE_QUOTA_EXCEEDED</code> (HTTP 507). Unknown-length (chunked) uploads are aborted mid-stream when they would exceed the limit. Read your numbers with <code>GET /api/v1/usage</code>.</p>
    </div>
  ),

  limits: () => (
    <div>
      <h1>Rate limits &amp; concurrency</h1>
      <h3>Rate limits</h3>
      <p>Fixed-window limits (defaults; configurable per deployment):</p>
      <ul>
        <li><b>API plane</b> — 2000 requests / 60 s, primarily per API key (failed-auth attempts are also limited per IP).</li>
        <li><b>Auth plane</b> — 300 requests / 60 s for login/signup/setup.</li>
      </ul>
      <p>When limited you get <code>RATE_LIMIT_EXCEEDED</code> (429) with standard headers: <code>Retry-After</code>, <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code>, <code>X-RateLimit-Reset</code>.</p>
      <h3>Concurrency</h3>
      <p>Per project, at most <b>10</b> concurrent uploads and <b>20</b> concurrent downloads. Beyond that you get <code>TOO_MANY_CONCURRENT_TRANSFERS</code> (429) — retry with backoff.</p>
      <div className="callout info">Every response carries an <code>X-Request-ID</code>. Log it — it correlates your request with the server's request log and any error the SDK throws.</div>
    </div>
  ),

  errors: () => (
    <div>
      <h1>Error reference</h1>
      <p>Errors are JSON: <code>{`{ "success": false, "error": { "code", "message" } }`}</code>. Binary endpoints return the status with an empty/redirect body. Codes are stable — branch on <code>code</code>, not on the message. This table is generated from the server's own status map.</p>
      <table className="table">
        <thead><tr><th>Code</th><th>HTTP</th><th>When</th></tr></thead>
        <tbody>
          {[
            ["VALIDATION_ERROR", 400, "Malformed input / bad JSON"],
            ["INVALID_UPLOAD", 400, "Empty or unreadable upload stream"],
            ["MISSING_API_KEY", 401, "No Authorization header"],
            ["INVALID_API_KEY", 401, "Unknown/invalid key"],
            ["API_KEY_REVOKED", 401, "Key was revoked"],
            ["INVALID_CREDENTIALS", 401, "Wrong email/password (dashboard)"],
            ["FORBIDDEN", 403, "Not allowed for this actor"],
            ["INSUFFICIENT_SCOPE", 403, "Key lacks the required scope"],
            ["PROJECT_DISABLED", 403, "Project not active"],
            ["CSRF_FAILED", 403, "Cross-origin session mutation"],
            ["FILE_NOT_FOUND", 404, "No such file in this project"],
            ["NOT_FOUND", 404, "No such resource"],
            ["CONFLICT", 409, "State conflict (e.g. delete a non-revoked key)"],
            ["PROJECT_DELETING", 409, "The project is being permanently deleted; the upload/trash was refused"],
            ["FILE_TOO_LARGE", 413, "Exceeds max upload size"],
            ["INVALID_RANGE", 416, "Unsatisfiable Range header"],
            ["RATE_LIMIT_EXCEEDED", 429, "Too many requests"],
            ["TOO_MANY_CONCURRENT_TRANSFERS", 429, "Concurrency cap hit"],
            ["INTERNAL", 500, "Unexpected server error"],
            ["STORAGE_UNAVAILABLE", 503, "Storage backend error"],
            ["STORAGE_QUOTA_EXCEEDED", 507, "Would exceed project quota"],
            ["INSUFFICIENT_STORAGE", 507, "Disk free-space floor reached"],
          ].map(([c, h, w]) => (
            <tr key={c}><td className="mono">{c}</td><td>{h}</td><td>{w}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  ),

  "sdk-install": () => (
    <div>
      <h1>SDK — install &amp; configure</h1>
      <p>The official Node.js client wraps the v1 API with streaming transfers and a typed error class. Requires <b>Node 18+</b>.</p>
      <CodeBlock lang="bash">{`npm install file:../grav-storage/packages/grav-storage-sdk
# or copy packages/grav-storage-sdk into your app and: npm install ./grav-storage-sdk`}</CodeBlock>
      <CodeBlock lang="node">{`import { GravStorage, GravStorageError } from "@grav/storage-sdk";

const storage = new GravStorage({
  baseUrl: process.env.GRAV_STORAGE_URL,   // e.g. http://localhost:4000
  apiKey: process.env.GRAV_STORAGE_API_KEY, // gsk_live_… (server-side only)
  timeoutMs: 0,                             // optional; 0 = no client timeout
});`}</CodeBlock>
      <div className="callout warn">The SDK is a <b>server-side</b> library. It uses <code>node:http</code>/<code>node:fs</code> and must never be bundled into browser code.</div>
    </div>
  ),

  "sdk-ref": () => (
    <div>
      <h1>SDK reference</h1>
      <h3>storage.files.upload(source, opts?)</h3>
      <p><code>source</code> = a file path (string), a <code>Buffer</code>, or any Node <code>Readable</code>. Streams — never buffers the whole file. <code>opts</code>: <code>{`{ name, contentType, size }`}</code>. Returns <code>{`{ fileId, name, mimeType, extension, sizeBytes, checksumSha256, createdAt }`}</code>.</p>
      <h3>storage.files.get(fileId, opts?)</h3>
      <p><code>opts.range</code> = <code>"bytes=0-1023"</code>. Returns <code>{`{ stream, status, contentType, contentLength, contentRange, acceptRanges, requestId }`}</code>. <code>stream</code> is a Node Readable — pipe it, don't buffer large files.</p>
      <h3>storage.files.download(fileId, dest, opts?)</h3>
      <p><code>dest</code> = a file path or a Writable. Streams to it; returns <code>{`{ bytes, status }`}</code>.</p>
      <h3>storage.files.meta(fileId) · list(params?) · delete(fileId)</h3>
      <p><code>meta</code> → the metadata object. <code>list({`{ limit, page, search, folder, type, sort }`})</code> → <code>{`{ files, total, page, limit, hasMore }`}</code>. <code>delete</code> → moves to trash.</p>
      <h3>storage.usage()</h3>
      <p>→ <code>{`{ currentStorageBytes, fileCount, quotaBytes, uploads, downloads, bytesUploaded, bytesDownloaded, requests, errors }`}</code>.</p>
      <h3>Errors</h3>
      <CodeBlock lang="node">{`try {
  await storage.files.meta("file_missing");
} catch (e) {
  if (e instanceof GravStorageError) {
    console.error(e.code, e.status, e.requestId);
    // e.g. FILE_NOT_FOUND 404 <X-Request-ID>
  }
}`}</CodeBlock>
      <p><code>GravStorageError</code> exposes <code>code</code> (stable), <code>status</code> (HTTP), <code>message</code> and <code>requestId</code>.</p>
    </div>
  ),

  "api-auth": () => (
    <div>
      <h1>HTTP API — base URL &amp; auth</h1>
      <p>All endpoints are under <code>/api/v1</code> and require <code>Authorization: Bearer gsk_…</code>. The success envelope is <code>{`{ "success": true, "data": {…} }`}</code>; byte endpoints return raw bytes. Every response includes <code>X-Request-ID</code>.</p>
      <p className="ep"><span className="method get">GET</span> <span>/api/v1/keyinfo</span></p>
      <p>Auth probe (scope <code>files:read</code>). Returns the project and key summary — never the secret.</p>
      <CodeBlock lang="bash">{`curl -H "Authorization: Bearer $KEY" http://localhost:4000/api/v1/keyinfo`}</CodeBlock>
    </div>
  ),

  "api-upload": () => (
    <div>
      <h1>Upload</h1>
      <p className="ep"><span className="method post">POST</span> <span>/api/v1/files</span> · scope <code>files:write</code></p>
      <p>Two body modes, both streamed to disk:</p>
      <h3>Raw octet-stream (recommended)</h3>
      <p>Send the bytes as the body; pass the name in a header.</p>
      <table className="table">
        <thead><tr><th>Header</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td className="mono">Content-Type: application/octet-stream</td><td>Raw body mode</td></tr>
          <tr><td className="mono">X-File-Name</td><td>URL-encoded filename</td></tr>
          <tr><td className="mono">X-File-Type</td><td>Optional content type hint</td></tr>
          <tr><td className="mono">Content-Length</td><td>Recommended; enables an early quota check</td></tr>
        </tbody>
      </table>
      <h3>Multipart form-data</h3>
      <p>A single file field, plus optional text fields <code>folderPath</code>, <code>tags</code>, <code>name</code>.</p>
      <h3>Response (201)</h3>
      <CodeBlock lang="json">{`{
  "success": true,
  "data": {
    "fileId": "file_DgJOyCOxCgDffshF9xaFV3jw",
    "name": "invoice.pdf",
    "mimeType": "application/pdf",
    "extension": "pdf",
    "sizeBytes": 20971520,
    "checksumSha256": "…",
    "createdAt": "2026-09-22T12:00:00.000Z"
  }
}`}</CodeBlock>
      <p><b>Errors:</b> <code>INVALID_UPLOAD</code> (400, empty), <code>FILE_TOO_LARGE</code> (413), <code>STORAGE_QUOTA_EXCEEDED</code> (507), <code>INSUFFICIENT_STORAGE</code> (507), <code>TOO_MANY_CONCURRENT_TRANSFERS</code> (429).</p>
      <div className="callout warn">Max upload size defaults to <b>2 GiB</b>. Uploads stream — do not base64-encode or buffer the whole file client-side.</div>
    </div>
  ),

  "api-chunked": () => (
    <div>
      <h1>Chunked upload (large files)</h1>
      <p className="docs-lede">A proxy in front of Grav Storage may cap a single request body (Cloudflare Free/Pro: ~100 MB). Large files are therefore sent as a sequence of <b>chunks</b>, each its own request, with progress persisted on the server — a failed or interrupted chunk is retried on its own instead of restarting the whole file.</p>
      <p>Endpoint: <code>POST /api/v1/files/chunk?op=begin | append | complete | abort</code> and <code>GET …?op=status | list</code> (scope <code>files:write</code>). The dashboard uses the same engine on its session plane. A session is bound to the API key that began it.</p>
      <h3>Flow</h3>
      <ol>
        <li><code>begin</code> with <code>{"{ filename, size, mimeType, sha256? }"}</code> → <code>{"{ uploadId, chunkSize, totalChunks, nextIndex }"}</code>.</li>
        <li>For each chunk <code>N</code> (bytes <code>N·chunkSize …</code>): <code>append&amp;uploadId=…&amp;index=N</code> with the raw bytes and header <code>x-chunk-sha256</code> (SHA-256 of the chunk). Resending an already-accepted chunk is harmless (<code>alreadyAccepted: true</code>).</li>
        <li><code>complete</code> with <code>{"{ manifestSha256 }"}</code> — SHA-256 of the concatenated hex chunk hashes — and ideally the full-file <code>sha256</code>. The server re-verifies every byte from disk before the file becomes visible.</li>
      </ol>
      <p>After any interruption, <code>GET ?op=status</code> returns <code>nextIndex</code>: continue from there. Chunk size defaults to 80 MiB (you may request smaller, never larger).</p>
      <div className="callout info">Full contract, every status code and the cleanup rules: <code>docs/chunked-upload-api.md</code> in the Grav Storage repo.</div>
    </div>
  ),

  "api-get": () => (
    <div>
      <h1>Retrieve &amp; download</h1>
      <p className="ep"><span className="method get">GET</span> <span>/api/v1/files/:fileId</span> · scope <code>files:read</code></p>
      <p>Streams the bytes inline (<code>Content-Disposition: inline</code>) with <code>Accept-Ranges: bytes</code>. Ideal for &lt;img&gt;/&lt;video&gt;/PDF preview proxied through your backend.</p>
      <p className="ep"><span className="method head">HEAD</span> <span>/api/v1/files/:fileId</span> · scope <code>files:read</code></p>
      <p>Headers only — <code>Content-Type</code>, <code>Content-Length</code>, <code>Accept-Ranges</code>. No body.</p>
      <p className="ep"><span className="method get">GET</span> <span>/api/v1/files/:fileId/download</span> · scope <code>files:read</code></p>
      <p>Same bytes but as an attachment (<code>Content-Disposition: attachment; filename=…</code>) so browsers save it.</p>
      <CodeBlock lang="bash">{`# stream to a file
curl -H "Authorization: Bearer $KEY" \\
  http://localhost:4000/api/v1/files/$FILE_ID/download -o out.pdf`}</CodeBlock>
      <p>Both support <a onClick={() => location.hash = "api-range"}>Range requests</a>. Missing objects return <code>FILE_NOT_FOUND</code> (404).</p>
    </div>
  ),

  "api-range": () => (
    <div>
      <h1>Range requests</h1>
      <p>The stream and download endpoints honor a single byte range — this is what lets a browser seek within a video or a PDF viewer jump to a page.</p>
      <table className="table">
        <thead><tr><th>Request</th><th>Response</th></tr></thead>
        <tbody>
          <tr><td>No <code>Range</code></td><td><b>200</b> — full body, <code>Content-Length</code> = size</td></tr>
          <tr><td><code>Range: bytes=0-1048575</code></td><td><b>206</b> — <code>Content-Range: bytes 0-1048575/&lt;size&gt;</code></td></tr>
          <tr><td><code>Range: bytes=1000-</code></td><td><b>206</b> — from byte 1000 to end</td></tr>
          <tr><td>Unsatisfiable (start ≥ size)</td><td><b>416</b> — <code>INVALID_RANGE</code>, <code>Content-Range: bytes */&lt;size&gt;</code></td></tr>
        </tbody>
      </table>
      <p className="muted small">Only a single range is supported (no multipart/byteranges). Multi-range headers fall back to the full body.</p>
      <CodeBlock lang="bash">{`curl -H "Authorization: Bearer $KEY" -H "Range: bytes=0-1023" \\
  http://localhost:4000/api/v1/files/$FILE_ID -o first-1kb.bin  # → 206`}</CodeBlock>
    </div>
  ),

  "api-meta": () => (
    <div>
      <h1>Metadata</h1>
      <p className="ep"><span className="method get">GET</span> <span>/api/v1/files/:fileId/meta</span> · scope <code>files:read</code></p>
      <p>Returns safe metadata JSON (no physical path).</p>
      <CodeBlock lang="json">{`{ "success": true, "data": { "file": {
  "fileId": "file_…", "name": "invoice.pdf", "mimeType": "application/pdf",
  "sizeBytes": 20971520, "checksumSha256": "…", "status": "active",
  "folderPath": ["invoices","2026"], "tags": ["paid"], "metadata": {},
  "downloads": 3, "bytesServed": 62914560,
  "createdAt": "…", "updatedAt": "…", "trashedAt": null
} } }`}</CodeBlock>
    </div>
  ),

  "api-list": () => (
    <div>
      <h1>List</h1>
      <p className="ep"><span className="method get">GET</span> <span>/api/v1/files</span> · scope <code>files:list</code></p>
      <p>Lists active files in the project (paginated).</p>
      <table className="table">
        <thead><tr><th>Query param</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td className="mono">page</td><td>1-based page (default 1)</td></tr>
          <tr><td className="mono">limit</td><td>Page size (default 20, max 100)</td></tr>
          <tr><td className="mono">search</td><td>Case-insensitive filename match</td></tr>
          <tr><td className="mono">folder</td><td>Exact folder path, e.g. <code>invoices/2026</code></td></tr>
          <tr><td className="mono">type</td><td>MIME prefix (<code>image/</code>) or category (<code>images</code>, <code>videos</code>, <code>audio</code>, <code>documents</code>, <code>archives</code>, <code>other</code>)</td></tr>
          <tr><td className="mono">sort</td><td>e.g. <code>-createdAt</code> (default), <code>name</code>, <code>-sizeBytes</code></td></tr>
        </tbody>
      </table>
      <CodeBlock lang="json">{`{ "success": true, "data": {
  "files": [ { "fileId": "file_…", "name": "…", "sizeBytes": 1234, … } ],
  "page": 1, "limit": 20, "total": 42, "hasMore": true
} }`}</CodeBlock>
    </div>
  ),

  "api-delete": () => (
    <div>
      <h1>Delete</h1>
      <p className="ep"><span className="method delete">DELETE</span> <span>/api/v1/files/:fileId</span> · scope <code>files:delete</code></p>
      <p>Moves the file to <b>trash</b> (soft delete). Its bytes free up the quota and it stops appearing in lists and reads. Trashed files are retained for a retention window (default 30 days) and then purged; an admin can restore or purge earlier from the dashboard.</p>
      <CodeBlock lang="json">{`{ "success": true, "data": { "fileId": "file_…", "status": "trashed", "trashedAt": "…" } }`}</CodeBlock>
      <p className="muted small">There is no hard-delete on the API plane — permanent purge is an explicit dashboard/admin action.</p>
    </div>
  ),

  "api-usage": () => (
    <div>
      <h1>Usage &amp; key info</h1>
      <p className="ep"><span className="method get">GET</span> <span>/api/v1/usage</span> · scope <code>files:read</code></p>
      <CodeBlock lang="json">{`{ "success": true, "data": {
  "currentStorageBytes": 4718592, "fileCount": 3, "quotaBytes": null,
  "uploads": 12, "downloads": 40,
  "bytesUploaded": 52428800, "bytesDownloaded": 104857600,
  "requests": 210, "errors": 2
} }`}</CodeBlock>
      <p className="ep"><span className="method get">GET</span> <span>/api/v1/keyinfo</span> · scope <code>files:read</code></p>
      <p>Returns <code>{`{ project: {id,name,status}, key: {id,name,env,scopes,keyPrefix} }`}</code> — a safe way to confirm a key works and see its scopes.</p>
    </div>
  ),

  "ex-node": () => (
    <div>
      <h1>Example — Node.js (SDK)</h1>
      <CodeBlock lang="node">{`import { GravStorage } from "@grav/storage-sdk";
const storage = new GravStorage({ baseUrl: process.env.GRAV_STORAGE_URL, apiKey: process.env.GRAV_STORAGE_API_KEY });

// upload from disk (streams)
const file = await storage.files.upload("./report.pdf", { contentType: "application/pdf" });

// list & search
const { files, total } = await storage.files.list({ search: "report", limit: 50 });

// range read (first 1 MiB)
const { stream, status } = await storage.files.get(file.fileId, { range: "bytes=0-1048575" });
// status === 206

// download to disk
await storage.files.download(file.fileId, "./copy.pdf");

// usage & cleanup
const usage = await storage.usage();
await storage.files.delete(file.fileId);`}</CodeBlock>
      <h3>Without the SDK (fetch)</h3>
      <CodeBlock lang="node">{`import fs from "node:fs";
const res = await fetch(process.env.GRAV_STORAGE_URL + "/api/v1/files", {
  method: "POST",
  headers: {
    authorization: "Bearer " + process.env.GRAV_STORAGE_API_KEY,
    "content-type": "application/octet-stream",
    "x-file-name": encodeURIComponent("report.pdf"),
  },
  body: fs.createReadStream("./report.pdf"),
  duplex: "half", // required when streaming a body with fetch
});
const { data } = await res.json();
console.log(data.fileId);`}</CodeBlock>
    </div>
  ),

  "ex-curl": () => (
    <div>
      <h1>Example — cURL</h1>
      <CodeBlock lang="bash">{`KEY=gsk_live_xxx
BASE=http://localhost:4000

# upload (raw octet-stream)
curl -X POST "$BASE/api/v1/files" \\
  -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/octet-stream" \\
  -H "X-File-Name: report.pdf" \\
  --data-binary @report.pdf

# metadata
curl -H "Authorization: Bearer $KEY" "$BASE/api/v1/files/$FILE_ID/meta"

# list images, page 1
curl -H "Authorization: Bearer $KEY" "$BASE/api/v1/files?type=images&limit=20"

# range (first 1 KiB) → 206
curl -H "Authorization: Bearer $KEY" -H "Range: bytes=0-1023" \\
  "$BASE/api/v1/files/$FILE_ID" -o first.bin

# download as attachment
curl -H "Authorization: Bearer $KEY" "$BASE/api/v1/files/$FILE_ID/download" -o out.pdf

# delete (→ trash)
curl -X DELETE -H "Authorization: Bearer $KEY" "$BASE/api/v1/files/$FILE_ID"`}</CodeBlock>
    </div>
  ),

  "ex-ps": () => (
    <div>
      <h1>Example — PowerShell</h1>
      <CodeBlock lang="powershell">{`$KEY  = "gsk_live_xxx"
$BASE = "http://localhost:4000"
$H    = @{ Authorization = "Bearer $KEY" }

# upload (raw octet-stream) — streams the file, does not buffer it in the pipeline
Invoke-RestMethod -Method Post -Uri "$BASE/api/v1/files" \`
  -Headers ($H + @{ "X-File-Name" = "report.pdf" }) \`
  -ContentType "application/octet-stream" \`
  -InFile "report.pdf"

# metadata
Invoke-RestMethod -Uri "$BASE/api/v1/files/$FILE_ID/meta" -Headers $H

# download as attachment
Invoke-WebRequest -Uri "$BASE/api/v1/files/$FILE_ID/download" -Headers $H -OutFile "out.pdf"

# delete (→ trash)
Invoke-RestMethod -Method Delete -Uri "$BASE/api/v1/files/$FILE_ID" -Headers $H`}</CodeBlock>
    </div>
  ),

  "ex-cms": () => (
    <div>
      <h1>Pattern — integrating from GRAV CMS (or any app)</h1>
      <p>Keep the key on your server. The browser talks to <i>your</i> route; your route uses the SDK.</p>
      <CodeBlock lang="node">{`// YOUR backend — e.g. an Express/Next route on cms.grav.in
import { GravStorage } from "@grav/storage-sdk";
const storage = new GravStorage({ baseUrl: process.env.GRAV_STORAGE_URL, apiKey: process.env.GRAV_STORAGE_API_KEY });

// 1) Browser POSTs the file to YOUR route (multipart or raw). You stream it on:
export async function uploadHandler(req, res) {
  const file = await storage.files.upload(req, {           // req is a Node Readable
    name: req.headers["x-filename"],
    size: Number(req.headers["content-length"]) || undefined,
  });
  // 2) Persist file.fileId in YOUR database against the user/record.
  await db.attachments.insert({ userId: req.user.id, fileId: file.fileId, name: file.name });
  res.json({ ok: true });
}

// 3) To show it later, stream it back through YOUR authenticated route:
export async function viewHandler(req, res) {
  const row = await db.attachments.find(req.params.id);
  const { stream, contentType } = await storage.files.get(row.fileId, { range: req.headers.range });
  res.setHeader("content-type", contentType);
  stream.pipe(res); // the browser never sees the key or the storage URL
}`}</CodeBlock>
      <div className="callout info">This mirrors how <code>cms.grav.in</code> would adopt Grav Storage: a thin server route holds the key; the fileId is stored in the CMS database. No CMS code is changed by reading these docs — this is the recommended shape when you choose to integrate.</div>
    </div>
  ),

  deploy: () => (
    <div>
      <h1>Production deployment</h1>
      <p className="docs-lede">Grav Storage is a standard Next.js (Node) app plus MongoDB and a data directory. A typical GRAV setup runs it on a Windows host behind a Cloudflare Tunnel.</p>
      <h3>1. Prerequisites</h3>
      <ul>
        <li>Node 18+ (tested on Node 22).</li>
        <li>MongoDB running locally (e.g. <code>mongodb://localhost:27017/grav_storage</code>). A dedicated database, separate from other apps.</li>
        <li>A data directory <b>outside the repo</b>, e.g. <code>D:\GravStorage\data</code> (plus its sibling <code>tmp</code>).</li>
      </ul>
      <h3>2. Environment</h3>
      <p>Create <code>.env</code> (never committed). See <a onClick={() => location.hash = "quickstart"}>Quick start</a> and the repo's <code>.env.example</code> for the full grouped list. At minimum set <code>MONGODB_URI</code>, <code>STORAGE_ROOT</code>, <code>JWT_SECRET</code>, <code>KEY_HASH_PEPPER</code>, and the bootstrap admin.</p>
      <h3>3. Build &amp; run</h3>
      <CodeBlock lang="bash">{`npm ci
npm run build
npm start           # serves on :4000 (next start -p 4000)`}</CodeBlock>
      <p>Run it under a process manager that restarts on boot/crash (Windows Service via NSSM, or pm2).</p>
      <div className="callout warn">Production is always the built app — <code>npm run build</code> then <code>npm start</code>. Never serve users from <code>npm run dev</code>: the dev server compiles routes on demand and has been seen to start without a route (for example the chunked-upload endpoint) until it is restarted. Production logs are path-free: absolute filesystem paths are redacted from every console line.</div>
      <h3>4. Cloudflare Tunnel</h3>
      <p>Expose <code>localhost:4000</code> as a public hostname (e.g. <code>storage.grav.in</code>) with a Cloudflare Tunnel — no inbound ports opened on the host.</p>
      <CodeBlock lang="yaml">{`# ~/.cloudflared/config.yml
tunnel: <TUNNEL_ID>
credentials-file: <path>/<TUNNEL_ID>.json
ingress:
  - hostname: storage.grav.in
    service: http://localhost:4000
  - service: http_status:404`}</CodeBlock>
      <div className="callout warn">Set your public origin appropriately. The dashboard's CSRF check compares <code>Origin</code>/<code>Referer</code> to <code>Host</code>; behind a proxy, make sure the original Host is preserved so same-origin dashboard requests are allowed. The Bearer API plane is unaffected.</div>
      <h3>5. First run</h3>
      <p>Open the site and complete the one-time super-admin setup, or set <code>BOOTSTRAP_ADMIN_EMAIL</code>/<code>BOOTSTRAP_ADMIN_PASSWORD</code> and change the password after first login. Then create a project + key.</p>
      <h3>6. Health</h3>
      <p><code>GET /api/health</code> returns <code>{`{ status, checks: { api, database, storage } }`}</code> (200 healthy, 503 degraded). Use it for uptime checks and as a tunnel/Load-balancer readiness probe. It exposes no internals.</p>
    </div>
  ),

  backup: () => (
    <div>
      <h1>Backup &amp; restore</h1>
      <p>Two things must be backed up <b>together</b> and consistently: the <b>MongoDB database</b> (metadata, projects, keys, usage) and the <b>data directory</b> (the bytes). A file's metadata and its object must match, so back them up close in time.</p>
      <h3>Backup</h3>
      <CodeBlock lang="bash">{`# 1) database
mongodump --uri "mongodb://localhost:27017/grav_storage" --out "D:\\Backups\\gs-<date>\\db"

# 2) data directory (the objects). Robocopy mirrors incrementally on Windows.
robocopy "D:\\GravStorage\\data" "D:\\Backups\\gs-<date>\\data" /MIR /R:2 /W:2`}</CodeBlock>
      <p>Prefer backing up during low traffic. The trash retention window means recently deleted files may still be on disk — that's expected.</p>
      <h3>Restore</h3>
      <CodeBlock lang="bash">{`mongorestore --uri "mongodb://localhost:27017/grav_storage" --drop "D:\\Backups\\gs-<date>\\db\\grav_storage"
robocopy "D:\\Backups\\gs-<date>\\data" "D:\\GravStorage\\data" /MIR /R:2 /W:2`}</CodeBlock>
      <h3>Verify after restore</h3>
      <ul>
        <li>Start the app; check <code>GET /api/health</code> is <code>ok</code>.</li>
        <li>Run the admin <b>Integrity</b> report (report-only) to confirm metadata and objects line up.</li>
        <li>Run the admin <b>Reconcile</b> report to confirm per-project counters match reality; apply per project if needed.</li>
      </ul>
      <div className="callout warn">Never restore the database without its matching data directory (or vice-versa) — you'll get orphaned metadata or orphaned bytes. The integrity checker reports these but never deletes automatically.</div>
    </div>
  ),

  maintenance: () => (
    <div>
      <h1>Maintenance</h1>
      <p>Admin-only operational tools (dashboard → Maintenance), all explicit and scoped — there is no "fix everything" button.</p>
      <ul>
        <li><b>Integrity checker</b> — report-only. Finds metadata without objects (orphans), objects without metadata, and size/checksum mismatches. It never deletes or repairs on its own.</li>
        <li><b>Reconcile</b> — recomputes a project's reconstructable counters (storage bytes, file count) from the objects. Reports drift; you apply per project explicitly.</li>
        <li><b>Temp cleanup</b> — removes stale <code>*.part</code> files from interrupted uploads (older than the temp max-age, default 24 h).</li>
        <li><b>Purge trash</b> — permanently removes trashed files past the retention window (default 30 days). Restores are possible until then.</li>
        <li><b>Chunked uploads</b> — expires idle resumable uploads (default 6 h after their last chunk), recovers interrupted finalizes, and removes chunk temp files no session references (older than 60 min). Never touches a live upload. Also runs as <code>npm run storage:chunks</code> — schedule it (e.g. hourly with Task Scheduler) so abandoned uploads release their disk space.</li>
        <li><b>Disk protection</b> — if a free-space floor is configured, uploads that would cross it are refused with <code>INSUFFICIENT_STORAGE</code>. User files are never auto-deleted to make room.</li>
      </ul>
      <div className="callout info">All admin actions are recorded in the audit log with the actor, action and a redacted detail payload (never secrets).</div>
    </div>
  ),
};
