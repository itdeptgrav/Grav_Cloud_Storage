"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { fmtBytes, timeAgo } from "@/lib/format";
import { Button, Field, Input, Textarea, Modal, ErrorNote, StatusBadge, StatCard, EmptyState, PageHeader, SectionHeader, Skeleton, toast } from "@/components/ui";
import Icon from "@/components/icons";

export default function Dashboard() {
  const [overview, setOverview] = useState(null);
  const [projects, setProjects] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    try { setProjects((await api.get("/api/projects")).projects); } catch { setProjects([]); }
    try { setOverview(await api.get("/api/dashboard/overview")); } catch { /* optional */ }
  }
  useEffect(() => { load(); }, []);

  const isAdmin = overview?.role === "superadmin";
  const t = overview?.totals;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={isAdmin ? "Platform overview" : "Your projects and storage"}
        actions={<Button variant="primary" icon="plus" onClick={() => setShowCreate(true)}>Create Project</Button>}
      />

      {/* Storage overview */}
      <div className="eyebrow">Storage overview</div>
      {!t ? (
        <div className="grid grid-stats"><Skeleton h={78} /><Skeleton h={78} /><Skeleton h={78} /><Skeleton h={78} /></div>
      ) : isAdmin ? (
        <div className="grid grid-stats">
          <StatCard label="Active storage" value={fmtBytes(t.currentStorageBytes)} icon="database" />
          <StatCard label="Files" value={t.fileCount.toLocaleString()} icon="file" />
          <StatCard label="Projects" value={t.projects} icon="folder" />
          <StatCard label="Users" value={t.users} icon="user" />
          <StatCard label="API requests" value={t.requests.toLocaleString()} icon="activity" />
        </div>
      ) : (
        <div className="grid grid-stats">
          <StatCard label="Active storage" value={fmtBytes(t.currentStorageBytes)} icon="database" />
          <StatCard label="Files" value={t.fileCount.toLocaleString()} icon="file" />
          <StatCard label="Projects" value={t.projects} icon="folder" />
          <StatCard label="Uploads" value={t.uploads.toLocaleString()} icon="upload" />
          <StatCard label="Downloads" value={t.downloads.toLocaleString()} icon="download" />
        </div>
      )}

      {isAdmin && overview?.disk?.volume?.ok && <DiskPanel disk={overview.disk} />}

      <SectionHeader title={isAdmin ? "All projects" : "Projects"} />

      {projects === null && (
        <div className="grid grid-cards">{[0, 1, 2].map((i) => <div key={i} className="card"><Skeleton w="60%" h={16} /><Skeleton w="40%" h={12} style={{ marginTop: 12 }} /><Skeleton w="80%" h={12} style={{ marginTop: 14 }} /></div>)}</div>
      )}
      {projects && projects.length === 0 && (
        <EmptyState icon="folder" title="No projects yet" action={<Button variant="primary" icon="plus" onClick={() => setShowCreate(true)}>Create Project</Button>}>
          Create your first project to start storing files and issuing API keys.
        </EmptyState>
      )}
      {projects && projects.length > 0 && (
        <div className="grid grid-cards">
          {projects.map((p) => (
            <a key={p.id} href={`/projects/${p.id}`} className="card card-hover" style={{ textDecoration: "none", color: "var(--text)" }}>
              <div className="between" style={{ alignItems: "flex-start" }}>
                <div className="row" style={{ gap: 9, minWidth: 0 }}>
                  <span className="avatar" style={{ borderRadius: 8 }}><Icon name="folder" size={15} /></span>
                  <strong className="truncate">{p.name}</strong>
                </div>
                <StatusBadge status={p.status} />
              </div>
              <p className="muted small truncate" style={{ margin: "10px 0 0", minHeight: 16 }}>{p.description || "No description"}</p>
              <div className="row small faint" style={{ gap: 14, marginTop: 12 }}>
                <span className="row" style={{ gap: 5 }}><Icon name="database" size={13} />{fmtBytes(p.currentStorageBytes)}</span>
                <span className="row" style={{ gap: 5 }}><Icon name="file" size={13} />{p.fileCount}</span>
                <span className="spacer" />
                <span>{timeAgo(p.updatedAt)}</span>
              </div>
            </a>
          ))}
        </div>
      )}

      {showCreate && <CreateProject onClose={() => setShowCreate(false)} onCreated={load} />}
    </>
  );
}

function CreateProject({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function create(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.post("/api/projects", { name, description: desc });
      toast.success("Project created");
      onClose();
      await onCreated();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  }
  return (
    <Modal title="Create project" onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={create}>Create project</Button></>}>
      <form onSubmit={create}>
        <ErrorNote>{err}</ErrorNote>
        <Field label="Project name" required><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required placeholder="GRAV CMS" /></Field>
        <Field label="Description" hint="Optional — shown on the project card."><Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Main GRAV CMS storage" /></Field>
      </form>
    </Modal>
  );
}

function DiskPanel({ disk }) {
  const { volume, activeStorage, trashStorage, gravUsage, lowSpaceWarning } = disk;
  const pct = volume.capacity ? (volume.used / volume.capacity) * 100 : 0;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="between">
        <div className="row" style={{ gap: 8 }}><Icon name="hardDrive" size={16} style={{ color: "var(--muted)" }} /><h2 style={{ margin: 0 }}>Storage disk</h2></div>
        {lowSpaceWarning && <span className="badge badge-warn"><Icon name="alertTri" size={12} />{pct.toFixed(0)}% full</span>}
      </div>
      <div className="meter" style={{ margin: "13px 0 8px" }}><i className={lowSpaceWarning ? "warn" : ""} style={{ width: `${pct}%` }} /></div>
      <div className="row small faint" style={{ gap: 18, flexWrap: "wrap" }}>
        <span>Capacity {fmtBytes(volume.capacity)}</span>
        <span>Used {fmtBytes(volume.used)} ({pct.toFixed(1)}%)</span>
        <span>Free {fmtBytes(volume.free)}</span>
      </div>
      <div className="grid grid-3" style={{ marginTop: 14 }}>
        <StatCard label="Active" value={fmtBytes(activeStorage)} sub="live files" />
        <StatCard label="Trash" value={fmtBytes(trashStorage)} sub="pending purge" />
        <StatCard label="On disk" value={fmtBytes(gravUsage)} sub="active + trash" />
      </div>
    </div>
  );
}
