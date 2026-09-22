"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/clientApi";
import { fmtBytes, timeAgo, fmtDate } from "@/lib/format";
import { Button, IconButton, Field, Input, Textarea, Modal, ErrorNote, Callout, Badge, StatusBadge, StatCard, EmptyState, PageHeader, SectionHeader, Tabs, Dropdown, MenuItem, CopyButton, confirmAction, toast, Loading, Skeleton } from "@/components/ui";
import Icon from "@/components/icons";
import CodeBlock from "@/components/CodeBlock";
import FileManager from "@/components/files/FileManager";

const ALL_SCOPES = [
  ["files:read", "Read files", "Download, stream and read file metadata"],
  ["files:write", "Upload files", "Create new files in the project"],
  ["files:list", "List files", "Enumerate and search files"],
  ["files:delete", "Delete files", "Move files to trash"],
];
const TABS = [["overview", "Overview"], ["files", "Files"], ["keys", "API Keys"], ["usage", "Usage"], ["requests", "Requests"], ["docs", "Documentation"], ["settings", "Settings"]];

export default function ProjectPage() {
  const { id } = useParams();
  const [tab, setTab] = useState("overview");
  const [project, setProject] = useState(null);
  const [keys, setKeys] = useState(null);
  const [me, setMe] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const loadProject = useCallback(async () => {
    try { setProject((await api.get(`/api/projects/${id}`)).project); }
    catch (e) { if (e.status === 404) setNotFound(true); }
  }, [id]);
  const loadKeys = useCallback(async () => {
    try { setKeys((await api.get(`/api/projects/${id}/keys`)).keys); } catch { /* ignore */ }
  }, [id]);

  useEffect(() => { loadProject(); loadKeys(); api.get("/api/auth/me").then((d) => setMe(d.user)).catch(() => {}); }, [loadProject, loadKeys]);

  if (notFound) return <EmptyState icon="folder" title="Project not found" action={<a className="btn btn-subtle" href="/dashboard">Back to dashboard</a>}>It may not exist, or you may not have access to it.</EmptyState>;
  if (!project) return (
    <><Skeleton w="40%" h={22} /><Skeleton w="24%" h={13} style={{ marginTop: 10 }} /><div style={{ marginTop: 24 }}><Loading /></div></>
  );

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <a href="/dashboard" className="row small muted" style={{ gap: 5, marginBottom: 8, width: "fit-content" }}><Icon name="arrowLeft" size={13} />Projects</a>
          <div className="row" style={{ gap: 10 }}>
            <h1 className="ph-title truncate">{project.name}</h1>
            <StatusBadge status={project.status} />
          </div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <span className="mono-id">{project.id}</span>
            <CopyButton value={project.id} iconOnly variant="ghost" toastMessage="Project ID copied" />
          </div>
        </div>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "overview" && <Overview project={project} keys={keys} />}
      {tab === "files" && <FileManager projectId={project.id} onChanged={loadProject} />}
      {tab === "keys" && <KeysTab project={project} keys={keys} reload={loadKeys} />}
      {tab === "usage" && <UsageTab project={project} keys={keys} />}
      {tab === "requests" && <RequestsTab project={project} keys={keys} />}
      {tab === "docs" && <DocsTab project={project} keys={keys} onKeys={() => setTab("keys")} />}
      {tab === "settings" && <SettingsTab project={project} me={me} onChange={loadProject} />}
    </>
  );
}

/* ── Overview ── */
function Overview({ project, keys }) {
  const c = project.counters || {};
  const activeKeys = (keys || []).filter((k) => k.status === "active").length;
  return (
    <>
      <div className="grid grid-stats">
        <StatCard label="Current storage" value={fmtBytes(project.currentStorageBytes)} icon="database" />
        <StatCard label="Files" value={project.fileCount} icon="file" />
        <StatCard label="Uploads" value={c.uploads ?? 0} icon="upload" />
        <StatCard label="Downloads" value={c.downloads ?? 0} icon="download" />
        <StatCard label="API requests" value={c.requests ?? 0} icon="activity" />
        <StatCard label="Active keys" value={activeKeys} icon="key" />
      </div>
      <div className="card mt-2">
        <h2>Project details</h2>
        <dl className="kv">
          <dt>Name</dt><dd>{project.name}</dd>
          <dt>Description</dt><dd>{project.description || "—"}</dd>
          <dt>Status</dt><dd><StatusBadge status={project.status} /></dd>
          <dt>Created</dt><dd title={new Date(project.createdAt).toLocaleString()}>{fmtDate(project.createdAt)}</dd>
          <dt>Project ID</dt><dd><span className="mono small">{project.id}</span></dd>
          <dt>Quota</dt><dd>{project.quotaBytes ? fmtBytes(project.quotaBytes) : "Unlimited"}</dd>
        </dl>
      </div>
      <Callout type="info" icon="info" style={{ marginTop: 14 }}>
        <b>Current storage</b> is live bytes on disk now (it decreases when files are trashed). <b>Uploaded/downloaded data</b> are historical bandwidth totals that never decrease.
      </Callout>
    </>
  );
}

/* ── Analytics ── */
function AnalyticsSection({ projectId }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); api.get(`/api/dashboard/projects/${projectId}/analytics?days=${days}`).then(setData).catch(() => setData({ series: [], totals: {} })); }, [projectId, days]);
  const t = data?.totals || {};
  const max = Math.max(1, ...(data?.series || []).map((d) => d.requests));
  return (
    <div className="card mb-2">
      <div className="between" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Analytics</h2>
        <div className="segmented">
          {[[1, "24h"], [7, "7d"], [30, "30d"]].map(([d, l]) => <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{l}</button>)}
        </div>
      </div>
      {!data ? <Loading /> : (
        <>
          <div className="grid grid-stats mb-2">
            <StatCard label="Requests" value={t.requests ?? 0} />
            <StatCard label="Uploads" value={t.uploads ?? 0} />
            <StatCard label="Downloads" value={t.downloads ?? 0} />
            <StatCard label="Uploaded" value={fmtBytes(t.bytesUp ?? 0)} />
            <StatCard label="Downloaded" value={fmtBytes(t.bytesDown ?? 0)} />
            <StatCard label="Error rate" value={`${((t.errorRate ?? 0) * 100).toFixed(1)}%`} />
          </div>
          {data.series?.length ? (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 92, paddingTop: 8 }}>
              {data.series.map((d) => (
                <div key={d.date} title={`${d.date}: ${d.requests} requests, ${d.errors} errors`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
                  <div style={{ width: "100%", height: `${(d.requests / max) * 68}px`, minHeight: d.requests ? 3 : 0, background: d.errors ? "var(--warn)" : "var(--accent)", borderRadius: "3px 3px 0 0" }} />
                  <span className="faint" style={{ fontSize: 9, marginTop: 4 }}>{d.date.slice(5)}</span>
                </div>
              ))}
            </div>
          ) : <p className="faint small">No activity recorded in this range yet.</p>}
          <p className="faint tiny" style={{ marginTop: 10 }}>Daily rollups survive request-log expiry · amber bars had errors.</p>
        </>
      )}
    </div>
  );
}

/* ── Usage ── */
function UsageTab({ project, keys }) {
  const c = project.counters || {};
  const used = project.currentStorageBytes || 0;
  const quota = project.quotaBytes;
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0;
  return (
    <>
      <div className="card mb-2">
        <div className="between"><h2 style={{ margin: 0 }}>Storage</h2><span className="small faint">{quota ? `${fmtBytes(used)} of ${fmtBytes(quota)}` : `${fmtBytes(used)} · unlimited`}</span></div>
        {quota ? <>
          <div className="meter" style={{ margin: "12px 0 6px" }}><i className={pct >= 90 ? "danger" : pct >= 75 ? "warn" : ""} style={{ width: `${pct}%` }} /></div>
          <div className="small faint">{pct.toFixed(1)}% used</div>
        </> : <div className="meter" style={{ margin: "12px 0 0" }}><i style={{ width: "12%", background: "var(--muted-2)" }} /></div>}
      </div>

      <div className="grid grid-stats mb-2">
        <StatCard label="Files" value={project.fileCount} icon="file" />
        <StatCard label="Uploads" value={c.uploads ?? 0} icon="upload" />
        <StatCard label="Downloads" value={c.downloads ?? 0} icon="download" />
        <StatCard label="Uploaded" value={fmtBytes(c.bytesUp ?? 0)} />
        <StatCard label="Downloaded" value={fmtBytes(c.bytesDown ?? 0)} />
        <StatCard label="Errors" value={c.errors ?? 0} icon="alertCircle" />
      </div>

      <AnalyticsSection projectId={project.id} />

      <SectionHeader title="Usage by API key" />
      {!keys ? <Loading /> : keys.length === 0 ? <EmptyState icon="key" title="No API keys">Per-key usage appears here once you create a key.</EmptyState> : (
        <div className="card card-pad-0" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Key</th><th className="num">Requests</th><th className="num">Uploads</th><th className="num">Downloads</th><th className="num">Up</th><th className="num">Down</th><th className="num">Errors</th><th>Last used</th></tr></thead>
            <tbody>
              {keys.map((k) => { const kc = k.counters || {}; return (
                <tr key={k.id}>
                  <td><span className="strong">{k.name}</span> <Badge kind={k.env === "live" ? "live" : "test"}>{k.env}</Badge></td>
                  <td className="small num">{kc.requests ?? 0}</td><td className="small num">{kc.uploads ?? 0}</td><td className="small num">{kc.downloads ?? 0}</td>
                  <td className="small num">{fmtBytes(kc.bytesUp ?? 0)}</td><td className="small num">{fmtBytes(kc.bytesDown ?? 0)}</td><td className="small num">{kc.errors ?? 0}</td>
                  <td className="small muted">{timeAgo(k.lastUsedAt)}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      )}
      <p className="faint small mt-1">Dashboard (human) transfers count toward project totals but not toward any API key.</p>
    </>
  );
}

/* ── Requests ── */
function RequestsTab({ project, keys }) {
  const [logs, setLogs] = useState(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [keyId, setKeyId] = useState("");

  useEffect(() => {
    setLogs(null);
    const p = new URLSearchParams({ page: String(page), limit: "50" });
    if (method) p.set("method", method); if (status) p.set("status", status); if (errorsOnly) p.set("errors", "1"); if (keyId) p.set("apiKeyId", keyId);
    api.get(`/api/dashboard/projects/${project.id}/requests?${p}`).then((d) => { setLogs(d.logs); setTotal(d.total); setHasMore(d.hasMore); }).catch(() => setLogs([]));
  }, [project.id, method, status, errorsOnly, keyId, page]);
  useEffect(() => { setPage(1); }, [method, status, errorsOnly, keyId]);

  const stClass = (s) => s >= 500 ? "st-5xx" : s >= 400 ? "st-4xx" : s >= 300 ? "st-3xx" : "st-2xx";
  return (
    <>
      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        <select className="select input-sm" value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: "auto" }}><option value="">All methods</option>{["GET", "POST", "HEAD", "DELETE"].map((m) => <option key={m}>{m}</option>)}</select>
        <select className="select input-sm" value={keyId} onChange={(e) => setKeyId(e.target.value)} style={{ width: "auto" }}><option value="">All API keys</option>{(keys || []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select>
        <Input className="input-sm" placeholder="Status e.g. 404" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 130 }} />
        <label className="check check-inline"><input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Errors only</label>
      </div>
      {logs === null && <Loading />}
      {logs && logs.length === 0 && <EmptyState icon="logs" title="No requests logged">No requests match this filter yet.</EmptyState>}
      {logs && logs.length > 0 && (
        <div className="card card-pad-0" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Time</th><th>Method</th><th>Operation</th><th className="num">Status</th><th className="num">Duration</th><th className="num">Transfer</th><th>Actor</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="small muted" title={new Date(l.ts).toLocaleString()}>{timeAgo(l.ts)}</td>
                  <td><span className={`method ${l.method.toLowerCase()}`}>{l.method}</span></td>
                  <td className="small muted">{l.operation}</td>
                  <td className={`small num ${stClass(l.status)}`}>{l.status}{l.errorCode ? <span className="faint tiny"> {l.errorCode}</span> : ""}</td>
                  <td className="small num">{Math.round(l.durationMs)}ms</td>
                  <td className="small num">{fmtBytes((l.bytesIn || 0) + (l.bytesOut || 0))}</td>
                  <td className="small truncate" style={{ maxWidth: 180 }}><Badge kind="neutral">{l.actorType}</Badge> <span className="muted">{l.actor}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {logs && total > 50 && (
        <div className="row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
          <span className="small faint">Page {page} · {total} requests</span>
          <Button size="sm" icon="chevronLeft" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
          <Button size="sm" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </>
  );
}

/* ── API Keys ── */
function KeysTab({ project, keys, reload }) {
  const [showCreate, setShowCreate] = useState(false);
  const [reveal, setReveal] = useState(null);
  const [menu, setMenu] = useState(null);

  async function onCreated(result) { setShowCreate(false); setReveal({ secret: result.secret, key: result.key, note: null }); await reload(); }
  async function revoke(k) {
    setMenu(null);
    if (!(await confirmAction({ title: "Revoke API key?", danger: true, subject: { icon: "key", name: k.name, meta: k.env }, body: "Requests using this key will immediately fail with 401. This cannot be undone.", confirmLabel: "Revoke key" }))) return;
    try { await api.post(`/api/keys/${k.id}/revoke`); toast.success("API key revoked"); await reload(); } catch (e) { toast.error(e.message); }
  }
  async function rotate(k) {
    setMenu(null);
    if (!(await confirmAction({ title: "Rotate API key?", subject: { icon: "key", name: k.name, meta: k.env }, body: "A new key is created with the same scopes. The old key stays active until you revoke it, so deploys don't break.", confirmLabel: "Rotate key" }))) return;
    try { const res = await api.post(`/api/keys/${k.id}/rotate`); toast.success("New key created"); setReveal({ secret: res.secret, key: res.key, note: res.note }); await reload(); } catch (e) { toast.error(e.message); }
  }
  async function del(k) {
    setMenu(null);
    if (!(await confirmAction({ title: "Delete revoked key?", danger: true, subject: { icon: "key", name: k.name }, body: "Permanently removes this revoked key record. This cannot be undone.", confirmLabel: "Delete" }))) return;
    try { await api.del(`/api/keys/${k.id}`); toast.success("Key deleted"); await reload(); } catch (e) { toast.error(e.message); }
  }

  return (
    <>
      <div className="between" style={{ marginBottom: 14 }}>
        <p className="muted small" style={{ margin: 0, maxWidth: 480 }}>Authenticate applications with server-side API keys. The secret is shown once at creation.</p>
        <Button variant="primary" icon="plus" onClick={() => setShowCreate(true)}>Create API Key</Button>
      </div>

      {keys === null && <Loading />}
      {keys && keys.length === 0 && <EmptyState icon="key" title="No API keys" action={<Button variant="primary" icon="plus" onClick={() => setShowCreate(true)}>Create API Key</Button>}>Create a server-side key to connect another application to this project.</EmptyState>}

      {keys && keys.length > 0 && (
        <div className="card card-pad-0" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Name</th><th>Key</th><th>Scopes</th><th>Last used</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td><span className="strong">{k.name}</span> <Badge kind={k.env === "live" ? "live" : "test"}>{k.env}</Badge></td>
                  <td className="mono small muted">{k.maskedKey}</td>
                  <td className="small">{k.scopes.map((s) => <span key={s} className="badge badge-neutral" style={{ marginRight: 4, fontSize: 10 }}>{s.replace("files:", "")}</span>)}</td>
                  <td className="small muted">{timeAgo(k.lastUsedAt)}</td>
                  <td><StatusBadge status={k.status} /></td>
                  <td className="right">
                    <div className="kebab">
                      <IconButton name="kebab" label="Actions" onClick={(e) => { e.stopPropagation(); setMenu(menu === k.id ? null : k.id); }} />
                      <Dropdown open={menu === k.id} onClose={() => setMenu(null)}>
                        {k.status === "active" && <>
                          <MenuItem icon="rotate" onClick={() => rotate(k)}>Rotate key</MenuItem>
                          <MenuItem icon="x" danger onClick={() => revoke(k)}>Revoke key</MenuItem>
                        </>}
                        {k.status === "revoked" && <MenuItem icon="trash" danger onClick={() => del(k)}>Delete key</MenuItem>}
                      </Dropdown>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateKeyModal projectId={project.id} onClose={() => setShowCreate(false)} onCreated={onCreated} />}
      {reveal && <RevealModal reveal={reveal} onClose={() => setReveal(null)} baseUrl={typeof window !== "undefined" ? window.location.origin : ""} />}
    </>
  );
}

function CreateKeyModal({ projectId, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [env, setEnv] = useState("live");
  const [scopes, setScopes] = useState(["files:read", "files:write", "files:list"]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const toggle = (s) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { onCreated(await api.post(`/api/projects/${projectId}/keys`, { name, env, scopes })); }
    catch (e2) { setErr(e2.message); setBusy(false); }
  }
  return (
    <Modal title="Create API Key" onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Create API Key</Button></>}>
      <form onSubmit={submit}>
        <ErrorNote>{err}</ErrorNote>
        <Field label="Key name" required><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required placeholder="Production Backend" /></Field>
        <Field label="Environment">
          <div className="row" style={{ gap: 8 }}>
            {[["live", "Live"], ["test", "Test"]].map(([v, l]) => (
              <label key={v} className={`check check-inline ${env === v ? "on" : ""}`} style={{ flex: 1, justifyContent: "center" }}><input type="radio" name="env" checked={env === v} onChange={() => setEnv(v)} /> {l}</label>
            ))}
          </div>
        </Field>
        <Field label="Permissions">
          <div className="checks">
            {ALL_SCOPES.map(([s, label, desc]) => (
              <label key={s} className={`check ${scopes.includes(s) ? "on" : ""}`}>
                <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} />
                <span className="ck-body"><span>{label} <span className="mono faint tiny">({s})</span></span><span className="ck-desc">{desc}</span></span>
              </label>
            ))}
          </div>
        </Field>
      </form>
    </Modal>
  );
}

function RevealModal({ reveal, onClose, baseUrl }) {
  const { secret, key, note } = reveal;
  const env = `GRAV_STORAGE_URL=${baseUrl}\nGRAV_STORAGE_API_KEY=${secret}`;
  return (
    <Modal title="API Key Created" onClose={onClose} width={560}
      footer={<Button variant="primary" onClick={onClose}>I&apos;ve saved the key</Button>}>
      <Callout type="ok" icon="checkCircle">Your <b>{key?.name}</b> key ({key?.env}) was created. This secret is shown <b>once</b> — copy it now.</Callout>

      <div className="eyebrow mt-3">Secret key</div>
      <div className="row" style={{ gap: 8, alignItems: "stretch" }}>
        <div className="secret-box" style={{ flex: 1 }}>{secret}</div>
        <CopyButton value={secret} label="Copy key" variant="primary" toastMessage="API key copied" />
      </div>

      <Callout type="warn" icon="alertTri" style={{ marginTop: 14 }}>Save this key now. For security you will <b>not</b> be able to view it again.</Callout>
      {note && <p className="faint small mt-1">{note}</p>}

      <div className="eyebrow mt-3">Quick setup</div>
      <CodeBlock lang=".env">{env}</CodeBlock>

      <p className="faint small mt-1">
        Keep this key on your server. Never expose it in frontend/browser code. See the{" "}
        <a href="/docs" target="_blank" rel="noreferrer">documentation center</a> for the full API.
      </p>
    </Modal>
  );
}

/* ── Documentation ── */
function DocsTab({ project, keys, onKeys }) {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const hasActiveKey = (keys || []).some((k) => k.status === "active");
  return (
    <div style={{ maxWidth: 760 }}>
      <Callout type="danger" icon="alertTri" style={{ marginBottom: 14 }}>
        <b>API keys are server-side secrets.</b> Never put a key in browser code or a <span className="mono">NEXT_PUBLIC_*</span> variable. Your browser → your backend → Grav Storage.
      </Callout>
      <div className="card">
        <h2>Integrate this project</h2>
        <p className="muted small mt-0">Files uploaded with this project&apos;s keys count against <b>this</b> project&apos;s quota and are isolated from every other project.</p>
        <dl className="kv">
          <dt>Base URL</dt><dd className="mono">{baseUrl}</dd>
          <dt>Project ID</dt><dd className="row" style={{ gap: 6 }}><span className="mono small">{project.id}</span><CopyButton value={project.id} iconOnly toastMessage="Project ID copied" /></dd>
        </dl>
        {!hasActiveKey && <Callout type="warn" icon="key" style={{ marginTop: 10 }}>No active API key yet. <button className="btn btn-sm btn-subtle" onClick={onKeys} style={{ marginLeft: 6 }}>Create one</button></Callout>}
      </div>
      <div className="card">
        <h2>1 · Configure your backend</h2>
        <p className="muted small mt-0">Create a key in the <button className="btn btn-ghost btn-sm" onClick={onKeys} style={{ padding: "0 4px" }}>API Keys</button> tab, then put it in your server-side <span className="mono">.env</span>:</p>
        <CodeBlock lang=".env">{`GRAV_STORAGE_URL=${baseUrl}\nGRAV_STORAGE_API_KEY=gsk_live_...   # server-side only`}</CodeBlock>
      </div>
      <div className="card">
        <h2>2 · Upload and store the fileId</h2>
        <CodeBlock lang="node">{`import { GravStorage } from "@grav/storage-sdk";\n\nconst storage = new GravStorage({\n  baseUrl: process.env.GRAV_STORAGE_URL,\n  apiKey: process.env.GRAV_STORAGE_API_KEY,\n});\n\nconst file = await storage.files.upload("./invoice.pdf");\n// save file.fileId in YOUR database — NOT a filesystem path`}</CodeBlock>
        <p className="small mt-1">Full reference in the <a href="/docs" target="_blank" rel="noreferrer">Documentation center →</a></p>
      </div>
    </div>
  );
}

/* ── Settings ── */
function SettingsTab({ project, me, onChange }) {
  const isAdmin = me?.role === "superadmin";
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description || "");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.patch(`/api/projects/${project.id}`, { name, description: desc }); toast.success("Project saved"); await onChange(); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  async function setStatus(status) {
    const labels = { active: "Enable", disabled: "Disable", archived: "Archive" };
    if (!(await confirmAction({ title: `${labels[status]} project?`, danger: status !== "active", body: status === "active" ? "The project and its API keys become usable again." : `A ${status} project rejects all of its API keys until re-enabled.`, confirmLabel: labels[status] }))) return;
    try { await api.patch(`/api/projects/${project.id}`, { status }); toast.success(`Project ${status}`); await onChange(); } catch (e) { toast.error(e.message); }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="card">
        <h2>Project details</h2>
        <form onSubmit={save}>
          <ErrorNote>{err}</ErrorNote>
          <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Description"><Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          <Button variant="primary" loading={busy}>Save changes</Button>
        </form>
      </div>

      <QuotaCard project={project} isAdmin={isAdmin} onChange={onChange} />

      <div className="card">
        <h2>Danger zone</h2>
        <div className="between">
          <div><div className="strong small">Project status</div><div className="faint small">Current: <StatusBadge status={project.status} />. A disabled or archived project rejects its API keys.</div></div>
          <div className="row" style={{ gap: 8 }}>
            {project.status !== "active" && <Button size="sm" onClick={() => setStatus("active")}>Enable</Button>}
            {project.status === "active" && <Button size="sm" variant="danger" onClick={() => setStatus("disabled")}>Disable</Button>}
            {project.status !== "archived" && <Button size="sm" variant="danger" onClick={() => setStatus("archived")}>Archive</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function QuotaCard({ project, isAdmin, onChange }) {
  const used = project.currentStorageBytes || 0;
  const quota = project.quotaBytes;
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0;
  const [unlimited, setUnlimited] = useState(quota == null);
  const [gb, setGb] = useState(quota ? (quota / (1024 ** 3)).toString() : "100");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const quotaBytes = unlimited ? null : Math.round(parseFloat(gb) * 1024 ** 3);
      await api.patch(`/api/projects/${project.id}`, { quotaBytes });
      toast.success("Quota updated"); await onChange();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="card">
      <h2>Storage quota</h2>
      <p className="muted small mt-0">{quota == null ? <>Unlimited — {fmtBytes(used)} used.</> : <>{fmtBytes(used)} / {fmtBytes(quota)} ({pct.toFixed(1)}%)</>}</p>
      {quota != null && <div className="meter" style={{ marginBottom: 12 }}><i className={pct >= 90 ? "danger" : ""} style={{ width: `${pct}%` }} /></div>}
      {isAdmin ? <>
        <label className="check check-inline" style={{ marginBottom: 10 }}><input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} /> Unlimited</label>
        {!unlimited && <Field label="Quota (GB)"><Input type="number" min="0" step="0.1" value={gb} onChange={(e) => setGb(e.target.value)} style={{ maxWidth: 160 }} /></Field>}
        <Button variant="primary" size="sm" loading={busy} onClick={save}>Save quota</Button>
      </> : <p className="faint small">Only a super-admin can change the quota.</p>}
    </div>
  );
}
