"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/clientApi";
import { fmtBytes, timeAgo, fmtDate } from "@/lib/format";
import { Button, Field, Input, Modal, ErrorNote, Badge, Copyable } from "@/components/ui";
import FileManager from "@/components/files/FileManager";
import CodeBlock from "@/components/CodeBlock";

const ALL_SCOPES = [
  ["files:read", "Read files"],
  ["files:write", "Upload files"],
  ["files:list", "List files"],
  ["files:delete", "Delete files"],
];

export default function ProjectPage() {
  const { id } = useParams();
  const [tab, setTab] = useState("overview");
  const [project, setProject] = useState(null);
  const [keys, setKeys] = useState(null);
  const [me, setMe] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const loadProject = useCallback(async () => {
    try {
      const d = await api.get(`/api/projects/${id}`);
      setProject(d.project);
    } catch (e) {
      if (e.status === 404) setNotFound(true);
    }
  }, [id]);

  const loadKeys = useCallback(async () => {
    try {
      const d = await api.get(`/api/projects/${id}/keys`);
      setKeys(d.keys);
    } catch {
      /* ignore */
    }
  }, [id]);

  useEffect(() => {
    loadProject();
    loadKeys();
    api.get("/api/auth/me").then((d) => setMe(d.user)).catch(() => {});
  }, [loadProject, loadKeys]);

  if (notFound) {
    return (
      <div className="card">
        <h2>Project not found</h2>
        <p className="muted">It may not exist, or you may not have access to it.</p>
        <a href="/dashboard">← Back to projects</a>
      </div>
    );
  }
  if (!project) return <p className="muted">Loading…</p>;

  return (
    <>
      <a href="/dashboard" className="muted small">← Projects</a>
      <div className="between" style={{ margin: "8px 0 14px" }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{project.name}</h1>
          <span className="muted small mono">{project.id}</span>
        </div>
        <Badge kind={project.status === "active" ? "active" : undefined}>{project.status}</Badge>
      </div>

      <div className="tabs">
        {[["overview", "Overview"], ["files", "Files"], ["keys", "API Keys"], ["usage", "Usage"], ["requests", "Requests"], ["docs", "Documentation"], ["settings", "Settings"]].map(([t, label]) => (
          <button key={t} className={`tab ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

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

function Stat({ label, value }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="muted small">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function Overview({ project, keys }) {
  const c = project.counters || {};
  const activeKeys = (keys || []).filter((k) => k.status === "active").length;
  return (
    <>
      <div className="grid grid-cards">
        <Stat label="Current Storage" value={fmtBytes(project.currentStorageBytes)} />
        <Stat label="File Count" value={project.fileCount} />
        <Stat label="Uploads" value={c.uploads ?? 0} />
        <Stat label="Downloads" value={c.downloads ?? 0} />
        <Stat label="Uploaded Data" value={fmtBytes(c.bytesUp ?? 0)} />
        <Stat label="Downloaded Data" value={fmtBytes(c.bytesDown ?? 0)} />
        <Stat label="API Requests" value={c.requests ?? 0} />
        <Stat label="API Keys (active)" value={activeKeys} />
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h2>Project</h2>
        <dl className="kv">
          <dt>Name</dt><dd>{project.name}</dd>
          <dt>Description</dt><dd>{project.description || "—"}</dd>
          <dt>Status</dt><dd><Badge kind={project.status === "active" ? "active" : undefined}>{project.status}</Badge></dd>
          <dt>Created</dt><dd title={new Date(project.createdAt).toLocaleString()}>{fmtDate(project.createdAt)}</dd>
          <dt>Project ID</dt><dd className="mono small">{project.id}</dd>
          <dt>Quota</dt><dd>{project.quotaBytes ? fmtBytes(project.quotaBytes) : "Unlimited"}</dd>
        </dl>
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        <b>Current Storage</b> is active bytes on disk now. <b>Uploaded/Downloaded Data</b> are historical bandwidth totals — they never decrease when files are deleted.
      </p>
    </>
  );
}

function AnalyticsSection({ projectId }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(null);
    api.get(`/api/dashboard/projects/${projectId}/analytics?days=${days}`).then(setData).catch(() => setData({ series: [], totals: {} }));
  }, [projectId, days]);
  const t = data?.totals || {};
  const max = Math.max(1, ...(data?.series || []).map((d) => d.requests));
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="between" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Analytics</h2>
        <div className="row" style={{ gap: 4 }}>
          {[[1, "24h"], [7, "7 days"], [30, "30 days"]].map(([d, l]) => (
            <button key={d} className={`chip ${days === d ? "chip-active" : ""}`} onClick={() => setDays(d)}>{l}</button>
          ))}
        </div>
      </div>
      {!data ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cards" style={{ marginBottom: 12 }}>
            <Stat label="Requests" value={t.requests ?? 0} />
            <Stat label="Uploads" value={t.uploads ?? 0} />
            <Stat label="Downloads" value={t.downloads ?? 0} />
            <Stat label="Uploaded Data" value={fmtBytes(t.bytesUp ?? 0)} />
            <Stat label="Downloaded Data" value={fmtBytes(t.bytesDown ?? 0)} />
            <Stat label="Error Rate" value={`${((t.errorRate ?? 0) * 100).toFixed(1)}%`} />
          </div>
          {data.series?.length ? (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 90 }}>
              {data.series.map((d) => (
                <div key={d.date} title={`${d.date}: ${d.requests} requests, ${d.errors} errors`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
                  <div style={{ width: "100%", height: `${(d.requests / max) * 70}px`, minHeight: d.requests ? 3 : 0, background: d.errors ? "var(--warn)" : "var(--accent)", borderRadius: "3px 3px 0 0" }} />
                  <span className="muted" style={{ fontSize: 9, marginTop: 4 }}>{d.date.slice(5)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">No activity recorded in this range yet.</p>
          )}
          <p className="muted small" style={{ marginTop: 8 }}>Daily rollups (survive request-log expiry). Bars show requests/day; amber = day had errors.</p>
        </>
      )}
    </div>
  );
}

function UsageTab({ project, keys }) {
  const c = project.counters || {};
  return (
    <>
      <AnalyticsSection projectId={project.id} />
      <div className="grid grid-cards">
        <Stat label="Current Storage" value={fmtBytes(project.currentStorageBytes)} />
        <Stat label="File Count" value={project.fileCount} />
        <Stat label="Uploads" value={c.uploads ?? 0} />
        <Stat label="Downloads" value={c.downloads ?? 0} />
        <Stat label="Total Uploaded" value={fmtBytes(c.bytesUp ?? 0)} />
        <Stat label="Total Downloaded" value={fmtBytes(c.bytesDown ?? 0)} />
        <Stat label="API Requests" value={c.requests ?? 0} />
        <Stat label="Errors" value={c.errors ?? 0} />
      </div>

      <div className="card" style={{ marginTop: 14, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "14px 14px 0" }}><h2 style={{ margin: 0 }}>Usage by API key</h2></div>
        {!keys ? (
          <p className="muted" style={{ padding: 14 }}>Loading…</p>
        ) : keys.length === 0 ? (
          <p className="muted" style={{ padding: 14 }}>No API keys yet.</p>
        ) : (
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr><th>Key</th><th>Requests</th><th>Uploads</th><th>Downloads</th><th>Up</th><th>Down</th><th>Errors</th><th>Last used</th></tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const kc = k.counters || {};
                return (
                  <tr key={k.id}>
                    <td>{k.name} <Badge kind={k.env === "live" ? "live" : "test"}>{k.env}</Badge></td>
                    <td className="small">{kc.requests ?? 0}</td>
                    <td className="small">{kc.uploads ?? 0}</td>
                    <td className="small">{kc.downloads ?? 0}</td>
                    <td className="small">{fmtBytes(kc.bytesUp ?? 0)}</td>
                    <td className="small">{fmtBytes(kc.bytesDown ?? 0)}</td>
                    <td className="small">{kc.errors ?? 0}</td>
                    <td className="small muted">{timeAgo(k.lastUsedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        Dashboard (human) uploads/downloads count toward the project totals but not toward any API key.
      </p>
    </>
  );
}

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
    if (method) p.set("method", method);
    if (status) p.set("status", status);
    if (errorsOnly) p.set("errors", "1");
    if (keyId) p.set("apiKeyId", keyId);
    api.get(`/api/dashboard/projects/${project.id}/requests?${p}`).then((d) => { setLogs(d.logs); setTotal(d.total); setHasMore(d.hasMore); }).catch(() => setLogs([]));
  }, [project.id, method, status, errorsOnly, keyId, page]);
  useEffect(() => { setPage(1); }, [method, status, errorsOnly, keyId]);

  return (
    <>
      <div className="toolbar">
        <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">All methods</option>{["GET", "POST", "HEAD", "DELETE"].map((m) => <option key={m}>{m}</option>)}
        </select>
        <select className="select" value={keyId} onChange={(e) => setKeyId(e.target.value)}>
          <option value="">All API keys</option>{(keys || []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        <input className="input input-sm" placeholder="status (e.g. 200)" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 130 }} />
        <label className="check"><input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Errors only</label>
      </div>
      {logs === null && <div className="state"><span className="spinner" /> Loading…</div>}
      {logs && logs.length === 0 && <div className="state">No requests logged for this filter yet.</div>}
      {logs && logs.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Time</th><th>Actor</th><th>Method</th><th>Operation</th><th>Status</th><th>Duration</th><th>Transferred</th><th>File</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="small muted" title={new Date(l.ts).toLocaleString()}>{timeAgo(l.ts)}</td>
                  <td className="small"><Badge>{l.actorType}</Badge> {l.actor}</td>
                  <td className="small">{l.method}</td>
                  <td className="small muted">{l.operation}</td>
                  <td className="small"><span style={{ color: l.status >= 400 ? "var(--down)" : "var(--up)" }}>{l.status}</span>{l.errorCode ? ` ${l.errorCode}` : ""}</td>
                  <td className="small">{Math.round(l.durationMs)}ms</td>
                  <td className="small">{fmtBytes((l.bytesIn || 0) + (l.bytesOut || 0))}</td>
                  <td className="small mono">{l.fileId ? l.fileId.slice(0, 14) + "…" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {logs && total > 50 && (
        <div className="row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
          <span className="small muted">Page {page} · {total} requests</span>
          <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
          <Button size="sm" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </>
  );
}

function KeysTab({ project, keys, reload }) {
  const [showCreate, setShowCreate] = useState(false);
  const [reveal, setReveal] = useState(null); // { secret, key, note }

  async function onCreated(result) {
    setShowCreate(false);
    setReveal({ secret: result.secret, key: result.key, note: null });
    await reload();
  }

  async function revoke(k) {
    if (!window.confirm(`Revoke "${k.name}"? Requests using this key will immediately fail.`)) return;
    await api.post(`/api/keys/${k.id}/revoke`);
    await reload();
  }

  async function rotate(k) {
    if (!window.confirm(`Rotate "${k.name}"? A new key is created; the old one stays active until you revoke it.`)) return;
    const res = await api.post(`/api/keys/${k.id}/rotate`);
    setReveal({ secret: res.secret, key: res.key, note: res.note });
    await reload();
  }

  async function del(k) {
    if (!window.confirm(`Permanently delete "${k.name}"? This cannot be undone.`)) return;
    await api.del(`/api/keys/${k.id}`);
    await reload();
  }

  return (
    <>
      <div className="between" style={{ marginBottom: 12 }}>
        <p className="muted small" style={{ margin: 0 }}>
          API keys authenticate other applications. The secret is shown once at creation.
        </p>
        <Button variant="primary" onClick={() => setShowCreate(true)}>+ Create API Key</Button>
      </div>

      {keys === null && <p className="muted">Loading…</p>}
      {keys && keys.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ marginTop: 0 }}>No API keys yet.</p>
          <Button variant="primary" onClick={() => setShowCreate(true)}>+ Create API Key</Button>
        </div>
      )}

      {keys && keys.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Scopes</th>
                <th>Last used</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>
                    {k.name} <Badge kind={k.env === "live" ? "live" : "test"}>{k.env}</Badge>
                  </td>
                  <td className="mono small">{k.maskedKey}</td>
                  <td className="small muted">{k.scopes.join(", ")}</td>
                  <td className="small muted">{timeAgo(k.lastUsedAt)}</td>
                  <td><Badge kind={k.status === "active" ? "active" : "revoked"}>{k.status}</Badge></td>
                  <td>
                    <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                      {k.status === "active" && (
                        <>
                          <Button size="sm" onClick={() => rotate(k)}>Rotate</Button>
                          <Button size="sm" variant="danger" onClick={() => revoke(k)}>Revoke</Button>
                        </>
                      )}
                      {k.status === "revoked" && (
                        <Button size="sm" variant="danger" onClick={() => del(k)}>Delete</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateKeyModal projectId={project.id} onClose={() => setShowCreate(false)} onCreated={onCreated} />
      )}
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

  function toggle(s) {
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await api.post(`/api/projects/${projectId}/keys`, { name, env, scopes });
      onCreated(res);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Create API Key" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorNote>{err}</ErrorNote>
        <Field label="Key name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required placeholder="GRAV CMS Production" />
        </Field>
        <Field label="Environment">
          <div className="row" style={{ gap: 8 }}>
            {["live", "test"].map((v) => (
              <label key={v} className={`check ${env === v ? "" : ""}`}>
                <input type="radio" name="env" checked={env === v} onChange={() => setEnv(v)} /> {v}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Scopes">
          <div className="checks">
            {ALL_SCOPES.map(([s, label]) => (
              <label key={s} className="check">
                <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} /> {label}
                <span className="muted small mono">({s})</span>
              </label>
            ))}
          </div>
        </Field>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy}>{busy ? "Generating…" : "Generate"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function RevealModal({ reveal, onClose, baseUrl }) {
  const { secret, key, note } = reveal;
  return (
    <Modal title="API Key Created" onClose={onClose} width={560}>
      <div className="notice notice-warn" style={{ marginBottom: 12 }}>
        Copy this key now. For security reasons you will <b>not</b> be able to view it again.
      </div>
      <div className="between" style={{ gap: 8, marginBottom: 12 }}>
        <div className="secret-box" style={{ flex: 1 }}>{secret}</div>
        <Copyable value={secret} />
      </div>
      {note && <p className="small muted">{note}</p>}
      <p className="eyebrow" style={{ marginTop: 14 }}>Quick start (.env)</p>
      <div className="secret-box">
        GRAV_STORAGE_URL={baseUrl}
        {"\n"}GRAV_STORAGE_API_KEY={secret}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Keep this on your server. Never expose it in frontend/browser code. See the{" "}
        <a href="/docs" target="_blank" rel="noreferrer">Documentation center</a> for the full upload/fetch API.
      </p>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <Button variant="primary" onClick={onClose}>I&apos;ve copied it — close</Button>
      </div>
    </Modal>
  );
}

function QuotaCard({ project, isAdmin, onChange }) {
  const used = project.currentStorageBytes || 0;
  const quota = project.quotaBytes;
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0;
  const [unlimited, setUnlimited] = useState(quota == null);
  const [gb, setGb] = useState(quota ? (quota / (1024 * 1024 * 1024)).toString() : "100");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const quotaBytes = unlimited ? null : Math.round(parseFloat(gb) * 1024 * 1024 * 1024);
      await api.patch(`/api/projects/${project.id}`, { quotaBytes });
      setMsg("Quota updated.");
      await onChange();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Storage quota</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        {quota == null ? (
          <>Unlimited — {fmtBytes(used)} used.</>
        ) : (
          <>{fmtBytes(used)} / {fmtBytes(quota)} ({pct.toFixed(1)}%)</>
        )}
      </p>
      {quota != null && <div className="meter" style={{ marginBottom: 10 }}><i className={pct >= 90 ? "warn" : ""} style={{ width: `${pct}%` }} /></div>}
      {isAdmin ? (
        <>
          <label className="check" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} /> Unlimited
          </label>
          {!unlimited && (
            <Field label="Quota (GB)"><Input type="number" min="0" step="0.1" value={gb} onChange={(e) => setGb(e.target.value)} style={{ maxWidth: 160 }} /></Field>
          )}
          {msg && <div className="notice notice-ok" style={{ margin: "8px 0" }}>{msg}</div>}
          <Button variant="primary" size="sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save quota"}</Button>
        </>
      ) : (
        <p className="muted small">Only a super-admin can change the quota.</p>
      )}
    </div>
  );
}

function SettingsTab({ project, me, onChange }) {
  const isAdmin = me?.role === "superadmin";
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description || "");
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.patch(`/api/projects/${project.id}`, { name, description: desc });
      setMsg("Saved.");
      await onChange();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status) {
    const verb = status === "active" ? "enable" : status;
    if (!window.confirm(`Really ${verb} this project?`)) return;
    await api.patch(`/api/projects/${project.id}`, { status });
    await onChange();
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <div className="card">
        <h2>Project details</h2>
        <form onSubmit={save}>
          <ErrorNote>{err}</ErrorNote>
          {msg && <div className="notice notice-ok" style={{ marginBottom: 12 }}>{msg}</div>}
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Description"><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          <Button variant="primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        </form>
      </div>

      <div className="card">
        <h2>Details</h2>
        <dl className="kv">
          <dt>Project ID</dt>
          <dd>
            <span className="mono small">{project.id}</span>{" "}
            <button className="btn btn-ghost btn-sm" onClick={() => { try { navigator.clipboard.writeText(project.id); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {} }}>{copied ? "Copied!" : "Copy"}</button>
          </dd>
          <dt>Created</dt><dd>{fmtDate(project.createdAt)}</dd>
        </dl>
      </div>

      <QuotaCard project={project} isAdmin={isAdmin} onChange={onChange} />

      <div className="card">
        <h2>Status</h2>
        <p className="muted small">
          Current: <Badge kind={project.status === "active" ? "active" : undefined}>{project.status}</Badge>.
          A disabled or archived project rejects its API keys.
        </p>
        <div className="row" style={{ gap: 8 }}>
          {project.status !== "active" && <Button onClick={() => setStatus("active")}>Enable</Button>}
          {project.status === "active" && <Button variant="danger" onClick={() => setStatus("disabled")}>Disable</Button>}
          {project.status !== "archived" && <Button variant="danger" onClick={() => setStatus("archived")}>Archive</Button>}
        </div>
      </div>
    </div>
  );
}

function DocsTab({ project, keys, onKeys }) {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const hasActiveKey = (keys || []).some((k) => k.status === "active");
  return (
    <div style={{ maxWidth: 760 }}>
      <div className="notice notice-error" style={{ marginBottom: 14 }}>
        <b>API keys are server-side secrets.</b> Never put a key in browser code or a <span className="mono">NEXT_PUBLIC_*</span> variable.
        Your browser → your backend → Grav Storage. Only your backend holds the key.
      </div>

      <div className="card">
        <h2>Integrate this project</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Files uploaded with this project&apos;s keys count against <b>this</b> project&apos;s quota and are isolated from every other project.
        </p>
        <dl className="kv">
          <dt>Base URL</dt><dd className="mono">{baseUrl}</dd>
          <dt>Project ID</dt><dd className="mono small">{project.id}</dd>
        </dl>
        {!hasActiveKey && (
          <div className="notice notice-warn" style={{ margin: "10px 0" }}>
            You have no active API key yet. <button className="btn btn-sm" onClick={onKeys}>Create one in API Keys →</button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>1 · Configure your backend</h2>
        <p className="muted small" style={{ marginTop: 0 }}>Create a key in the <button className="btn btn-ghost btn-sm" onClick={onKeys} style={{ padding: "0 4px" }}>API Keys</button> tab (shown once), then put it in your server-side <span className="mono">.env</span>:</p>
        <CodeBlock lang="env">{`GRAV_STORAGE_URL=${baseUrl}\nGRAV_STORAGE_API_KEY=gsk_live_...   # from the API Keys tab (server-side only)`}</CodeBlock>
      </div>

      <div className="card">
        <h2>2 · Upload and store the fileId</h2>
        <CodeBlock lang="node">{`import { GravStorage } from "@grav/storage-sdk";

const storage = new GravStorage({
  baseUrl: process.env.GRAV_STORAGE_URL,
  apiKey: process.env.GRAV_STORAGE_API_KEY,
});

const file = await storage.files.upload("./invoice.pdf");
// ✅ save file.fileId in YOUR database — NOT a filesystem path
await db.attachments.insert({ fileId: file.fileId, name: file.name });`}</CodeBlock>
      </div>

      <div className="card">
        <h2>3 · Retrieve it later</h2>
        <CodeBlock lang="node">{`const meta = await storage.files.meta(fileId);
await storage.files.download(fileId, "./out.pdf");   // streams
const { stream, status } = await storage.files.get(fileId, { range: "bytes=0-1048575" }); // 206`}</CodeBlock>
        <p className="small" style={{ marginTop: 12 }}>
          Full reference — auth, scopes, the HTTP API, errors, examples and deployment — is in the{" "}
          <a href="/docs" target="_blank" rel="noreferrer">Documentation center →</a>
        </p>
      </div>
    </div>
  );
}
