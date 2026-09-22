"use client";
// Server-side API playground. IMPORTANT: this exercises the SESSION (dashboard)
// plane using your login cookie — NO API key is ever placed in the browser. It
// drives the SAME storage engine as /api/v1, so it's a faithful way to try
// upload / list / metadata / range / delete. In production your BACKEND performs
// the equivalent /api/v1 calls with a server-side API key.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { Button, Field, Input } from "@/components/ui";
import { fmtBytes } from "@/lib/format";

const HDRS = ["x-request-id", "content-type", "content-length", "content-range", "accept-ranges", "cache-control"];

export default function PlaygroundPage() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("hello.txt");
  const [content, setContent] = useState("Hello from the Grav Storage playground!");
  const [range, setRange] = useState("bytes=0-15");
  const [exchange, setExchange] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/api/projects").then((d) => {
      setProjects(d.projects);
      if (d.projects[0]) setProjectId(d.projects[0].id);
    }).catch(() => {});
  }, []);

  const loadFiles = useCallback(async () => {
    if (!projectId) return;
    try {
      const d = await api.get(`/api/dashboard/projects/${projectId}/files?limit=50`);
      setFiles(d.files || []);
      if (d.files?.[0] && !d.files.some((f) => f.fileId === selected)) setSelected(d.files[0].fileId);
    } catch { /* ignore */ }
  }, [projectId, selected]);

  useEffect(() => { loadFiles(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run a request against the dashboard plane and record the exchange.
  async function run(method, path, { body, headers, binary } = {}) {
    setBusy(true);
    const started = performance.now();
    try {
      const res = await fetch(path, { method, headers, body, credentials: "same-origin" });
      const ms = Math.round(performance.now() - started);
      const respHeaders = {};
      HDRS.forEach((h) => { const v = res.headers.get(h); if (v) respHeaders[h] = v; });
      let bodyView;
      if (binary) {
        const buf = await res.arrayBuffer();
        bodyView = `«${buf.byteLength} bytes of binary data»`;
      } else {
        const txt = await res.text();
        try { bodyView = JSON.stringify(JSON.parse(txt), null, 2); } catch { bodyView = txt.slice(0, 2000); }
      }
      setExchange({ method, path, status: res.status, ok: res.ok, ms, respHeaders, bodyView });
      return { status: res.status, ok: res.ok };
    } catch (e) {
      setExchange({ method, path, status: 0, ok: false, ms: 0, respHeaders: {}, bodyView: String(e.message || e) });
      return { status: 0, ok: false };
    } finally {
      setBusy(false);
    }
  }

  const base = `/api/dashboard/projects/${projectId}/files`;

  async function doUpload() {
    if (!projectId) return;
    const blob = new Blob([content], { type: "application/octet-stream" });
    const r = await run("POST", base, {
      body: blob,
      headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name || "upload.bin") },
    });
    if (r.ok) await loadFiles();
  }
  const doList = () => run("GET", `${base}?limit=50`);
  const doMeta = () => selected && run("GET", `${base}/${selected}`);
  const doGet = () => selected && run("GET", `${base}/${selected}/raw`, { headers: range ? { range } : {}, binary: true });
  async function doDelete() {
    if (!selected) return;
    const r = await run("DELETE", `${base}/${selected}`);
    if (r.ok) { setSelected(""); await loadFiles(); }
  }

  return (
    <>
      <div className="between" style={{ marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>API Playground</h1>
        <a href="/docs" className="btn btn-sm" target="_blank" rel="noreferrer">Docs ↗</a>
      </div>
      <div className="notice notice-warn" style={{ marginBottom: 16 }}>
        This runs against the <b>session</b> (dashboard) plane with your login cookie — <b>no API key is placed in the browser</b>.
        It drives the same storage engine as <span className="mono">/api/v1</span>. In production, your <b>backend</b> makes the equivalent
        <span className="mono"> /api/v1</span> calls with a server-side key.
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="card">
          <h2>Request</h2>
          <Field label="Project">
            <select className="select" value={projectId} onChange={(e) => { setProjectId(e.target.value); setSelected(""); }} style={{ width: "100%" }}>
              {projects.length === 0 && <option value="">No projects — create one first</option>}
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>

          <p className="eyebrow" style={{ marginTop: 16 }}>Upload</p>
          <Field label="File name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Content (text)"><textarea className="input" rows={3} value={content} onChange={(e) => setContent(e.target.value)} /></Field>
          <Button variant="primary" disabled={busy || !projectId} onClick={doUpload}>POST upload</Button>

          <p className="eyebrow" style={{ marginTop: 18 }}>Operate on a file</p>
          <Field label="File">
            <select className="select" value={selected} onChange={(e) => setSelected(e.target.value)} style={{ width: "100%" }}>
              {files.length === 0 && <option value="">No files yet — upload one</option>}
              {files.map((f) => <option key={f.fileId} value={f.fileId}>{f.name} · {fmtBytes(f.sizeBytes)}</option>)}
            </select>
          </Field>
          <Field label="Range header (for GET)"><Input value={range} onChange={(e) => setRange(e.target.value)} placeholder="bytes=0-1023 (optional)" /></Field>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Button disabled={busy || !projectId} onClick={doList}>GET list</Button>
            <Button disabled={busy || !selected} onClick={doMeta}>GET meta</Button>
            <Button disabled={busy || !selected} onClick={doGet}>GET bytes {range ? "(range)" : ""}</Button>
            <Button variant="danger" disabled={busy || !selected} onClick={doDelete}>DELETE</Button>
          </div>
        </div>

        <div className="card">
          <h2>Response</h2>
          {!exchange && <div className="state">Run a request to see the response.</div>}
          {exchange && (
            <>
              <div className="row" style={{ gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <span className="mono small">{exchange.method}</span>
                <span className="mono small muted" style={{ wordBreak: "break-all" }}>{exchange.path}</span>
                <span className="spacer" />
                <span className={`badge ${exchange.ok ? "badge-active" : "badge-revoked"}`}>{exchange.status || "ERR"}</span>
                <span className="small muted">{exchange.ms}ms</span>
              </div>
              {Object.keys(exchange.respHeaders).length > 0 && (
                <dl className="kv" style={{ gridTemplateColumns: "150px 1fr" }}>
                  {Object.entries(exchange.respHeaders).map(([k, v]) => (
                    <div key={k} style={{ display: "contents" }}><dt className="mono small">{k}</dt><dd className="mono small">{v}</dd></div>
                  ))}
                </dl>
              )}
              <div className="code" style={{ marginTop: 10 }}><pre><code>{exchange.bodyView}</code></pre></div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
