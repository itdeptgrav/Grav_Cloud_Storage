"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { fmtBytes, timeAgo } from "@/lib/format";
import { Button, Field, Input, Modal, ErrorNote, Badge } from "@/components/ui";

function Stat({ label, value, sub }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="muted small">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{value}</div>
      {sub && <div className="muted small" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [overview, setOverview] = useState(null);
  const [projects, setProjects] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const d = await api.get("/api/projects");
      setProjects(d.projects);
    } catch {
      setProjects([]);
    }
    try {
      setOverview(await api.get("/api/dashboard/overview"));
    } catch {
      /* overview optional */
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/api/projects", { name, description: desc });
      setShowCreate(false);
      setName("");
      setDesc("");
      await load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  const isAdmin = overview?.role === "superadmin";
  const t = overview?.totals;

  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <div>
          <h1>Dashboard</h1>
          <p className="muted small" style={{ margin: 0 }}>{isAdmin ? "Platform overview (super-admin)" : "Your projects and storage"}</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>+ Create Project</Button>
      </div>

      {/* summary cards */}
      {t && !isAdmin && (
        <div className="grid grid-cards" style={{ marginBottom: 8 }}>
          <Stat label="Projects" value={t.projects} />
          <Stat label="Current Storage" value={fmtBytes(t.currentStorageBytes)} />
          <Stat label="Files" value={t.fileCount} />
          <Stat label="Uploads" value={t.uploads} />
          <Stat label="Downloads" value={t.downloads} />
          <Stat label="API Requests" value={t.requests} />
        </div>
      )}

      {t && isAdmin && (
        <>
          <div className="grid grid-cards" style={{ marginBottom: 8 }}>
            <Stat label="Total Users" value={t.users} />
            <Stat label="Total Projects" value={t.projects} />
            <Stat label="Active Storage" value={fmtBytes(t.currentStorageBytes)} />
            <Stat label="Trash Storage" value={fmtBytes(overview.disk?.trashStorage || 0)} />
            <Stat label="Total Files" value={t.fileCount} />
            <Stat label="API Requests" value={t.requests} />
          </div>
          {overview.disk?.volume?.ok && <DiskPanel disk={overview.disk} />}
          {t.largestProjects?.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <h2>Largest projects</h2>
              <table className="table">
                <thead><tr><th>Project</th><th>Active Storage</th><th>Files</th><th>Status</th></tr></thead>
                <tbody>
                  {t.largestProjects.map((p) => (
                    <tr key={p.id}><td>{p.name}</td><td>{fmtBytes(p.currentStorageBytes)}</td><td>{p.fileCount}</td><td><Badge kind={p.status === "active" ? "active" : undefined}>{p.status}</Badge></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <h2 style={{ margin: "22px 0 12px" }}>{isAdmin ? "All projects" : "Projects"}</h2>

      {projects === null && <p className="muted">Loading…</p>}
      {projects && projects.length === 0 && (
        <div className="state">
          You haven&apos;t created a project yet.
          <div style={{ marginTop: 12 }}><Button variant="primary" onClick={() => setShowCreate(true)}>+ Create Project</Button></div>
        </div>
      )}
      {projects && projects.length > 0 && (
        <div className="grid grid-cards">
          {projects.map((p) => (
            <a key={p.id} href={`/projects/${p.id}`} className="card" style={{ textDecoration: "none", color: "var(--text)" }}>
              <div className="between"><strong>{p.name}</strong><Badge kind={p.status === "active" ? "active" : undefined}>{p.status}</Badge></div>
              <p className="muted small" style={{ minHeight: 18 }}>{p.description || "—"}</p>
              <div className="row small muted" style={{ gap: 16, marginTop: 8 }}>
                <span>{fmtBytes(p.currentStorageBytes)}</span>
                <span>{p.fileCount} files</span>
              </div>
              <div className="muted small" style={{ marginTop: 4 }}>Updated {timeAgo(p.updatedAt)}</div>
            </a>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="Create Project" onClose={() => setShowCreate(false)}>
          <form onSubmit={create}>
            <ErrorNote>{err}</ErrorNote>
            <Field label="Project name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required placeholder="GRAV CMS" /></Field>
            <Field label="Description (optional)"><Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Main GRAV CMS storage" /></Field>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <Button type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button variant="primary" disabled={busy}>{busy ? "Creating…" : "Create"}</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function DiskPanel({ disk }) {
  const { volume, activeStorage, trashStorage, gravUsage, lowSpaceWarning } = disk;
  const pct = volume.capacity ? (volume.used / volume.capacity) * 100 : 0;
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="between"><h2 style={{ margin: 0 }}>Storage disk</h2>{lowSpaceWarning && <span className="badge badge-revoked">Disk {pct.toFixed(0)}% full</span>}</div>
      <div className="meter" style={{ margin: "12px 0 6px" }}><i className={lowSpaceWarning ? "warn" : ""} style={{ width: `${pct}%` }} /></div>
      <div className="row small muted" style={{ gap: 18, flexWrap: "wrap" }}>
        <span>Capacity {fmtBytes(volume.capacity)}</span>
        <span>Used {fmtBytes(volume.used)} ({pct.toFixed(1)}%)</span>
        <span>Free {fmtBytes(volume.free)}</span>
      </div>
      <hr className="hr" />
      <div className="grid grid-cards">
        <Stat label="Active Storage" value={fmtBytes(activeStorage)} sub="live files" />
        <Stat label="Trash Storage" value={fmtBytes(trashStorage)} sub="pending purge, still on disk" />
        <Stat label="Grav Storage on disk" value={fmtBytes(gravUsage)} sub="active + trash" />
      </div>
    </div>
  );
}
