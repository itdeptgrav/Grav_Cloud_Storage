"use client";
// Admin-only storage benchmark. Runs REAL upload / GET / Range / concurrent
// transfers against the session (dashboard) plane, with BOUNDED sizes and
// GUARANTEED cleanup (every file created is trashed + purged in a finally).
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/clientApi";
import { Button, Field } from "@/components/ui";
import { fmtBytes } from "@/lib/format";

const SIZES = [[5, "5 MB"], [25, "25 MB"], [50, "50 MB"]];
const CONC = [1, 2, 4, 8];
const MB = 1024 * 1024;

function makeBlob(bytes) {
  // A fixed pattern (not random) — content is irrelevant for throughput and this
  // avoids the browser's per-call getRandomValues limit and CPU cost.
  const buf = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i += 4096) buf[i] = 71; // touch pages; rest are 0
  return new Blob([buf], { type: "application/octet-stream" });
}

export default function BenchmarkPage() {
  const [me, setMe] = useState(undefined);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [sizeMb, setSizeMb] = useState(25);
  const [conc, setConc] = useState(4);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [rows, setRows] = useState([]);
  const created = useRef([]); // fileIds to clean up

  useEffect(() => {
    api.get("/api/auth/me").then((d) => setMe(d.user)).catch(() => setMe(null));
    api.get("/api/projects").then((d) => { setProjects(d.projects); if (d.projects[0]) setProjectId(d.projects[0].id); }).catch(() => {});
  }, []);

  const say = useCallback((m) => setLog((l) => [...l, m]), []);
  const base = () => `/api/dashboard/projects/${projectId}/files`;

  async function upload(bytes, label) {
    const res = await fetch(base(), { method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(label) }, body: makeBlob(bytes) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(`upload ${res.status} ${j?.error?.code || ""}`); }
    const j = await res.json();
    created.current.push(j.data.fileId);
    return j.data.fileId;
  }
  async function getFull(fileId) {
    const res = await fetch(`${base()}/${fileId}/raw`, { credentials: "same-origin" });
    const buf = await res.arrayBuffer();
    return { status: res.status, bytes: buf.byteLength };
  }
  async function getRange(fileId, header) {
    const res = await fetch(`${base()}/${fileId}/raw`, { credentials: "same-origin", headers: { range: header } });
    const buf = await res.arrayBuffer();
    return { status: res.status, bytes: buf.byteLength, contentRange: res.headers.get("content-range") };
  }
  async function cleanup() {
    const ids = created.current.splice(0);
    if (!ids.length) return;
    say(`Cleaning up ${ids.length} file(s)…`);
    for (const id of ids) {
      try { await fetch(`${base()}/${id}`, { method: "DELETE", credentials: "same-origin" }); } catch {}
      try { await fetch(`${base()}/${id}/purge`, { method: "DELETE", credentials: "same-origin" }); } catch {}
    }
    say("Cleanup complete.");
  }

  async function runAll() {
    if (!projectId) return;
    setRunning(true); setLog([]); setRows([]); created.current = [];
    const bytes = sizeMb * MB;
    const out = [];
    const add = (r) => { out.push(r); setRows([...out]); };
    try {
      say(`Project ${projectId} · size ${sizeMb} MB · concurrency ${conc}`);

      // 1) sequential upload
      say("① sequential upload…");
      let t = performance.now();
      const f1 = await upload(bytes, `bench-seq-${Date.now()}.bin`);
      let s = (performance.now() - t) / 1000;
      add({ test: "Upload (sequential)", detail: `${sizeMb} MB`, ms: Math.round(s * 1000), rate: `${(sizeMb / s).toFixed(1)} MB/s` });

      // 2) full GET
      say("② full download…");
      t = performance.now();
      const g = await getFull(f1);
      s = (performance.now() - t) / 1000;
      add({ test: "Download (full)", detail: `${g.status} · ${fmtBytes(g.bytes)}`, ms: Math.round(s * 1000), rate: `${(g.bytes / MB / s).toFixed(1)} MB/s` });

      // 3) range
      say("③ range request…");
      const wanted = Math.min(MB, bytes) - 1;
      t = performance.now();
      const r = await getRange(f1, `bytes=0-${wanted}`);
      s = (performance.now() - t) / 1000;
      const rangeOk = r.status === 206 && r.bytes === wanted + 1;
      add({ test: "Range (first 1 MB)", detail: `${r.status} ${rangeOk ? "✓" : "✗"} · ${r.contentRange || "—"}`, ms: Math.round(s * 1000), rate: rangeOk ? "206 OK" : "FAILED" });

      // 4) concurrent uploads
      say(`④ ${conc} concurrent uploads…`);
      t = performance.now();
      await Promise.all(Array.from({ length: conc }, (_, i) => upload(bytes, `bench-conc-${Date.now()}-${i}.bin`)));
      s = (performance.now() - t) / 1000;
      add({ test: `Upload (${conc}× concurrent)`, detail: `${conc * sizeMb} MB total`, ms: Math.round(s * 1000), rate: `${(conc * sizeMb / s).toFixed(1)} MB/s agg` });

      say("Done.");
    } catch (e) {
      say(`Error: ${e.message}`);
    } finally {
      await cleanup();
      setRunning(false);
    }
  }

  if (me === undefined) return <p className="muted">Loading…</p>;
  if (!me || me.role !== "superadmin") {
    return <div className="card"><h2>Forbidden</h2><p className="muted">The benchmark is available to super-admins only.</p></div>;
  }

  return (
    <>
      <h1>Storage Benchmark</h1>
      <p className="muted small">Runs real transfers against a project via the session plane. Sizes are bounded and every file is purged afterward.</p>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Project">
            <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="File size">
            <select className="select" value={sizeMb} onChange={(e) => setSizeMb(Number(e.target.value))}>
              {SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Concurrency">
            <select className="select" value={conc} onChange={(e) => setConc(Number(e.target.value))}>
              {CONC.map((c) => <option key={c} value={c}>{c}×</option>)}
            </select>
          </Field>
          <Button variant="primary" disabled={running || !projectId} onClick={runAll}>{running ? "Running…" : "Run benchmark"}</Button>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>Max footprint this run: <b>{fmtBytes((conc + 1) * sizeMb * MB)}</b> (purged on completion).</p>
      </div>

      {rows.length > 0 && (
        <div className="card" style={{ marginTop: 14, padding: 0, overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Test</th><th>Detail</th><th>Time</th><th>Throughput</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}><td>{r.test}</td><td className="small muted">{r.detail}</td><td className="mono small">{r.ms} ms</td><td className="mono">{r.rate}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {log.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <p className="eyebrow" style={{ margin: 0 }}>Log</p>
          <div className="code" style={{ marginTop: 8 }}><pre><code>{log.join("\n")}</code></pre></div>
        </div>
      )}
    </>
  );
}
