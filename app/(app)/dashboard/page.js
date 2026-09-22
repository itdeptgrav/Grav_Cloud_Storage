"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { fmtBytes } from "@/lib/format";
import { Button, Field, Input, Modal, ErrorNote, Badge } from "@/components/ui";

export default function Dashboard() {
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

  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <div>
          <h1>Projects</h1>
          <p className="muted small" style={{ margin: 0 }}>Create a project, then generate API keys for it.</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>+ Create Project</Button>
      </div>

      {projects === null && <p className="muted">Loading…</p>}

      {projects && projects.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 44 }}>
          <p style={{ fontSize: 16, marginTop: 0 }}>You haven&apos;t created a project yet.</p>
          <Button variant="primary" onClick={() => setShowCreate(true)}>+ Create Project</Button>
        </div>
      )}

      {projects && projects.length > 0 && (
        <div className="grid grid-cards">
          {projects.map((p) => (
            <a key={p.id} href={`/projects/${p.id}`} className="card" style={{ textDecoration: "none", color: "var(--text)" }}>
              <div className="between">
                <strong>{p.name}</strong>
                <Badge kind={p.status === "active" ? "active" : undefined}>{p.status}</Badge>
              </div>
              <p className="muted small" style={{ minHeight: 18 }}>{p.description || "—"}</p>
              <div className="row small muted" style={{ gap: 16, marginTop: 8 }}>
                <span>{p.fileCount} files</span>
                <span>{fmtBytes(p.currentStorageBytes)}</span>
              </div>
            </a>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="Create Project" onClose={() => setShowCreate(false)}>
          <form onSubmit={create}>
            <ErrorNote>{err}</ErrorNote>
            <Field label="Project name">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required placeholder="GRAV CMS" />
            </Field>
            <Field label="Description (optional)">
              <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Main GRAV CMS storage" />
            </Field>
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
