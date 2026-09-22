"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { fmtBytes } from "@/lib/format";
import { Button, Badge } from "@/components/ui";

export default function MaintenancePage() {
  const [me, setMe] = useState(null);
  const [recon, setRecon] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.get("/api/auth/me").then((d) => setMe(d.user)).catch(() => setMe(false));
  }, []);

  async function reconcileReport() {
    setBusy("recon");
    setMsg(null);
    try {
      const d = await api.get("/api/admin/reconcile");
      setRecon(d.projects);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy("");
    }
  }
  async function reconcileApply(projectId) {
    if (!window.confirm("Recompute and overwrite this project's storage counters from actual files?")) return;
    setBusy("recon");
    try {
      await api.post("/api/admin/reconcile", { projectId });
      await reconcileReport();
    } catch (e) {
      setMsg(e.message);
      setBusy("");
    }
  }
  async function maint(action, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action);
    setMsg(null);
    try {
      const r = await api.post("/api/admin/maintenance", { action });
      setMsg(`Done: ${JSON.stringify(r)}`);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy("");
    }
  }

  if (me === null) return <p className="muted">Loading…</p>;
  if (!me || me.role !== "superadmin") return <div className="card"><h2>Forbidden</h2><p className="muted">Super-admin only.</p></div>;

  return (
    <>
      <h1>Maintenance</h1>
      <p className="muted small">Operational tools. Each action states exactly what it does — there is no “fix everything” button.</p>
      {msg && <div className="notice notice-ok" style={{ margin: "10px 0" }}>{msg}</div>}

      <div className="grid grid-cards" style={{ marginTop: 12 }}>
        <div className="card">
          <h2>Integrity</h2>
          <p className="muted small">Detect missing files, orphans, size/checksum mismatches. Report-only.</p>
          <a className="btn btn-primary btn-sm" href="/admin/integrity">Open Integrity</a>
        </div>
        <div className="card">
          <h2>Clean temp files</h2>
          <p className="muted small">Remove stale <code>tmp/*.part</code> from crashed uploads (older than the threshold).</p>
          <Button size="sm" disabled={busy === "temp-clean"} onClick={() => maint("temp-clean")}>{busy === "temp-clean" ? "Cleaning…" : "Clean Stale Temp Files"}</Button>
        </div>
        <div className="card">
          <h2>Purge expired trash</h2>
          <p className="muted small">Permanently remove trashed files past retention. Destructive.</p>
          <Button size="sm" variant="danger" disabled={busy === "purge-trash"} onClick={() => maint("purge-trash", "Permanently purge all trashed files past the retention window?")}>{busy === "purge-trash" ? "Purging…" : "Purge Expired Trash"}</Button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="between"><h2 style={{ margin: 0 }}>Usage reconciliation</h2><Button size="sm" disabled={busy === "recon"} onClick={reconcileReport}>Run report</Button></div>
        <p className="muted small">Recomputes <b>currentStorageBytes</b> / <b>fileCount</b> from actual files (report first; repair is explicit). Historical bandwidth counters are accumulated and not reconstructable.</p>
        {recon && (
          recon.length === 0 ? <p className="muted">No projects.</p> : (
            <table className="table">
              <thead><tr><th>Project</th><th>Recorded</th><th>Expected</th><th>Diff (bytes / files)</th><th></th></tr></thead>
              <tbody>
                {recon.map((r) => (
                  <tr key={r.projectId}>
                    <td>{r.name}</td>
                    <td className="small">{fmtBytes(r.recorded.currentStorageBytes)} / {r.recorded.fileCount}</td>
                    <td className="small">{fmtBytes(r.expected.currentStorageBytes)} / {r.expected.fileCount}</td>
                    <td className="small">{r.inSync ? <Badge kind="active">in sync</Badge> : <span style={{ color: "var(--warn)" }}>{r.diff.currentStorageBytes} / {r.diff.fileCount}</span>}</td>
                    <td>{!r.inSync && <Button size="sm" onClick={() => reconcileApply(r.projectId)}>Repair</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      <p className="muted small" style={{ marginTop: 14 }}>
        CLI equivalents: <code>npm run storage:integrity</code>, <code>storage:reconcile</code>, <code>storage:cleanup</code>, <code>storage:purge-trash</code>.
      </p>
    </>
  );
}
