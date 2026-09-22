"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/clientApi";
import { fmtBytes, timeAgo, fmtDate } from "@/lib/format";
import { Button, Field, Input, Modal, ErrorNote, Badge, Copyable } from "@/components/ui";

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
        {[["overview", "Overview"], ["keys", "API Keys"], ["settings", "Settings"]].map(([t, label]) => (
          <button key={t} className={`tab ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview project={project} keys={keys} />}
      {tab === "keys" && <KeysTab project={project} keys={keys} reload={loadKeys} />}
      {tab === "settings" && <SettingsTab project={project} onChange={loadProject} />}
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
  const activeKeys = (keys || []).filter((k) => k.status === "active").length;
  return (
    <>
      <div className="grid grid-cards">
        <Stat label="Storage Used" value={fmtBytes(project.currentStorageBytes)} />
        <Stat label="Files" value={project.fileCount} />
        <Stat label="API Keys (active)" value={activeKeys} />
        <Stat label="Requests" value={project.counters?.requests ?? 0} />
        <Stat label="Uploads" value={project.counters?.uploads ?? 0} />
        <Stat label="Downloads" value={project.counters?.downloads ?? 0} />
      </div>
      <p className="muted small" style={{ marginTop: 14 }}>
        Files, uploads, downloads and bandwidth start counting once the storage API (Phase 2) is live.
      </p>
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
        Keep this on your server. Never expose it in frontend/browser code. Full upload/fetch API arrives in Phase 2.
      </p>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <Button variant="primary" onClick={onClose}>I&apos;ve copied it — close</Button>
      </div>
    </Modal>
  );
}

function SettingsTab({ project, onChange }) {
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description || "");
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

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
