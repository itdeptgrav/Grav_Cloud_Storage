"use client";
// Server-side playground — runs against the SESSION plane (login cookie), so NO
// API key is ever placed in the browser. Same storage engine as /api/v1.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { Button, Field, Input, Textarea, Select, Badge, Callout, PageHeader, EmptyState } from "@/components/ui";
import Icon from "@/components/icons";
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

  useEffect(() => { api.get("/api/projects").then((d) => { setProjects(d.projects); if (d.projects[0]) setProjectId(d.projects[0].id); }).catch(() => {}); }, []);

  const loadFiles = useCallback(async () => {
    if (!projectId) return;
    try { const d = await api.get(`/api/dashboard/projects/${projectId}/files?limit=50`); setFiles(d.files || []); if (d.files?.[0] && !d.files.some((f) => f.fileId === selected)) setSelected(d.files[0].fileId); } catch { /* ignore */ }
  }, [projectId, selected]);
  useEffect(() => { loadFiles(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(method, path, { body, headers, binary } = {}) {
    setBusy(true);
    const started = performance.now();
    try {
      const res = await fetch(path, { method, headers, body, credentials: "same-origin" });
      const ms = Math.round(performance.now() - started);
      const respHeaders = {}; HDRS.forEach((h) => { const v = res.headers.get(h); if (v) respHeaders[h] = v; });
      let bodyView;
      if (binary) { const buf = await res.arrayBuffer(); bodyView = `«${buf.byteLength} bytes of binary data»`; }
      else { const txt = await res.text(); try { bodyView = JSON.stringify(JSON.parse(txt), null, 2); } catch { bodyView = txt.slice(0, 2000); } }
      setExchange({ method, path, status: res.status, ok: res.ok, ms, respHeaders, bodyView });
      return { status: res.status, ok: res.ok };
    } catch (e) { setExchange({ method, path, status: 0, ok: false, ms: 0, respHeaders: {}, bodyView: String(e.message || e) }); return { status: 0, ok: false }; }
    finally { setBusy(false); }
  }
  const base = `/api/dashboard/projects/${projectId}/files`;
  async function doUpload() {
    if (!projectId) return;
    const blob = new Blob([content], { type: "application/octet-stream" });
    const r = await run("POST", base, { body: blob, headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name || "upload.bin") } });
    if (r.ok) await loadFiles();
  }
  const doList = () => run("GET", `${base}?limit=50`);
  const doMeta = () => selected && run("GET", `${base}/${selected}`);
  const doGet = () => selected && run("GET", `${base}/${selected}/raw`, { headers: range ? { range } : {}, binary: true });
  async function doDelete() { if (!selected) return; const r = await run("DELETE", `${base}/${selected}`); if (r.ok) { setSelected(""); await loadFiles(); } }

  return (
    <>
      <PageHeader title="API Playground" subtitle="Try the storage API against your projects." actions={<a href="/docs" className="btn btn-subtle btn-sm" target="_blank" rel="noreferrer"><Icon name="externalLink" size={13} />Docs</a>} />
      <Callout type="warn" icon="shield" style={{ marginBottom: 16 }}>
        This runs against the <b>session</b> plane with your login cookie — <b>no API key is placed in the browser</b>. It drives the same storage engine as <span className="mono">/api/v1</span>. In production, your <b>backend</b> makes the equivalent calls with a server-side key.
      </Callout>

      {projects.length === 0 ? <EmptyState icon="folder" title="No projects" action={<a className="btn btn-primary" href="/dashboard">Create a project</a>}>Create a project first to use the playground.</EmptyState> : (
        <div className="grid grid-2" style={{ alignItems: "start", gap: 16 }}>
          <div className="card">
            <h2>Request</h2>
            <Field label="Project"><Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setSelected(""); }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <div className="eyebrow mt-2">Upload</div>
            <Field label="File name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Content (text)"><Textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} /></Field>
            <Button variant="primary" icon="upload" disabled={busy || !projectId} onClick={doUpload}>POST upload</Button>

            <div className="eyebrow mt-3">Operate on a file</div>
            <Field label="File"><Select value={selected} onChange={(e) => setSelected(e.target.value)}>{files.length === 0 ? <option value="">No files yet — upload one</option> : files.map((f) => <option key={f.fileId} value={f.fileId}>{f.name} · {fmtBytes(f.sizeBytes)}</option>)}</Select></Field>
            <Field label="Range header (for GET)"><Input value={range} onChange={(e) => setRange(e.target.value)} placeholder="bytes=0-1023 (optional)" /></Field>
            <div className="row wrap" style={{ gap: 8 }}>
              <Button size="sm" icon="list" disabled={busy || !projectId} onClick={doList}>GET list</Button>
              <Button size="sm" icon="info" disabled={busy || !selected} onClick={doMeta}>GET meta</Button>
              <Button size="sm" icon="download" disabled={busy || !selected} onClick={doGet}>GET bytes</Button>
              <Button size="sm" variant="danger" icon="trash" disabled={busy || !selected} onClick={doDelete}>DELETE</Button>
            </div>
          </div>

          <div className="card">
            <h2>Response</h2>
            {!exchange ? <div className="state">Run a request to see the response.</div> : (
              <>
                <div className="row wrap" style={{ gap: 10, marginBottom: 10 }}>
                  <span className={`method ${exchange.method.toLowerCase()}`}>{exchange.method}</span>
                  <span className="mono small muted truncate" style={{ flex: 1 }}>{exchange.path}</span>
                  <Badge kind={exchange.ok ? "active" : "danger"}>{exchange.status || "ERR"}</Badge>
                  <span className="small faint">{exchange.ms}ms</span>
                </div>
                {Object.keys(exchange.respHeaders).length > 0 && (
                  <dl className="kv" style={{ gridTemplateColumns: "140px 1fr", marginBottom: 10 }}>
                    {Object.entries(exchange.respHeaders).map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt className="mono small">{k}</dt><dd className="mono small">{v}</dd></div>)}
                  </dl>
                )}
                <div className="code"><pre><code>{exchange.bodyView}</code></pre></div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
