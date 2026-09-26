"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { fmtBytes } from "@/lib/format";
import { Button, Badge, PageHeader, SectionHeader, EmptyState, Loading, Callout, confirmAction, toast } from "@/components/ui";
import Icon from "@/components/icons";

export default function MaintenancePage() {
  const [me, setMe] = useState(null);
  const [recon, setRecon] = useState(null);
  const [busy, setBusy] = useState("");

  useEffect(() => { api.get("/api/auth/me").then((d) => setMe(d.user)).catch(() => setMe(false)); }, []);

  async function reconcileReport() {
    setBusy("recon");
    try { setRecon((await api.get("/api/admin/reconcile")).projects); } catch (e) { toast.error(e.message); } finally { setBusy(""); }
  }
  async function reconcileApply(projectId, name) {
    if (!(await confirmAction({ title: "Repair counters?", subject: { icon: "DB", name }, body: "Recompute currentStorageBytes / fileCount from the actual files and overwrite the stored values. Historical bandwidth counters are not touched.", confirmLabel: "Repair" }))) return;
    setBusy("recon");
    try { await api.post("/api/admin/reconcile", { projectId }); toast.success("Counters repaired"); await reconcileReport(); } catch (e) { toast.error(e.message); setBusy(""); }
  }
  async function maint(action) {
    if (action === "purge-trash" && !(await confirmAction({ title: "Purge expired trash?", danger: true, body: "Permanently removes all trashed files past the retention window. This cannot be undone.", confirmLabel: "Purge trash" }))) return;
    setBusy(action);
    try { const r = await api.post("/api/admin/maintenance", { action }); toast.success(action === "temp-clean" ? `Removed ${r.removed} stale temp file(s) (${fmtBytes(r.bytes || 0)})` : action === "chunk-clean" ? `Expired ${r.expired} idle upload(s), recovered ${r.interrupted}, removed ${r.orphansRemoved} orphan(s) (${fmtBytes(r.bytesFreed || 0)})` : `Purged ${r.purged ?? 0} file(s)`); }
    catch (e) { toast.error(e.message); } finally { setBusy(""); }
  }

  if (me === null) return <Loading />;
  if (!me || me.role !== "superadmin") return <EmptyState icon="shield" title="Super-admin only">You don&apos;t have access to maintenance tools.</EmptyState>;

  return (
    <>
      <PageHeader title="Maintenance" subtitle="Operational tools — each action states exactly what it does. There is no “fix everything” button." />

      <div className="eyebrow">Safe · report-only</div>
      <div className="grid grid-3">
        <div className="card">
          <div className="row" style={{ gap: 8 }}><Icon name="shield" size={16} style={{ color: "var(--accent-2)" }} /><h3 style={{ margin: 0 }}>Integrity check</h3></div>
          <p className="muted small" style={{ margin: "8px 0 12px" }}>Detect missing files, orphans and size/checksum mismatches. Never modifies data.</p>
          <a className="btn btn-subtle btn-sm" href="/admin/integrity"><Icon name="externalLink" size={13} />Open Integrity</a>
        </div>
        <div className="card">
          <div className="row" style={{ gap: 8 }}><Icon name="wrench" size={16} style={{ color: "var(--accent-2)" }} /><h3 style={{ margin: 0 }}>Clean temp files</h3></div>
          <p className="muted small" style={{ margin: "8px 0 12px" }}>Remove stale <code>tmp/*.part</code> from interrupted uploads past the age threshold.</p>
          <Button size="sm" loading={busy === "temp-clean"} icon="refresh" onClick={() => maint("temp-clean")}>Clean temp files</Button>
        </div>
        <div className="card">
          <div className="row" style={{ gap: 8 }}><Icon name="upload" size={16} style={{ color: "var(--accent-2)" }} /><h3 style={{ margin: 0 }}>Chunked uploads</h3></div>
          <p className="muted small" style={{ margin: "8px 0 12px" }}>Expire idle chunked uploads and delete their temp data; remove orphaned chunk temp files. Never touches a live upload.</p>
          <Button size="sm" loading={busy === "chunk-clean"} icon="refresh" onClick={() => maint("chunk-clean")}>Clean chunked uploads</Button>
        </div>
        <div className="card">
          <div className="row" style={{ gap: 8 }}><Icon name="database" size={16} style={{ color: "var(--accent-2)" }} /><h3 style={{ margin: 0 }}>Reconcile counters</h3></div>
          <p className="muted small" style={{ margin: "8px 0 12px" }}>Report drift between stored and actual storage/file counts. Repair is explicit, per project.</p>
          <Button size="sm" loading={busy === "recon"} icon="activity" onClick={reconcileReport}>Run report</Button>
        </div>
      </div>

      <div className="eyebrow mt-3">Destructive</div>
      <div className="card">
        <div className="between">
          <div><div className="row" style={{ gap: 8 }}><Icon name="trash" size={16} style={{ color: "var(--danger)" }} /><h3 style={{ margin: 0 }}>Purge expired trash</h3></div>
            <p className="muted small" style={{ margin: "6px 0 0" }}>Permanently remove trashed files past the retention window. Cannot be undone.</p></div>
          <Button size="sm" variant="danger" loading={busy === "purge-trash"} icon="trash" onClick={() => maint("purge-trash")}>Purge trash</Button>
        </div>
      </div>

      {recon && (<>
        <SectionHeader title="Usage reconciliation" />
        {recon.length === 0 ? <EmptyState icon="database" title="No projects" /> : (
          <div className="card card-pad-0" style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Project</th><th>Recorded</th><th>Expected</th><th>Diff</th><th></th></tr></thead>
              <tbody>
                {recon.map((r) => (
                  <tr key={r.projectId}>
                    <td className="strong">{r.name}</td>
                    <td className="small muted">{fmtBytes(r.recorded.currentStorageBytes)} · {r.recorded.fileCount}</td>
                    <td className="small muted">{fmtBytes(r.expected.currentStorageBytes)} · {r.expected.fileCount}</td>
                    <td className="small">{r.inSync ? <Badge kind="active" dot>in sync</Badge> : <span className="st-4xx">{r.diff.currentStorageBytes} B · {r.diff.fileCount} files</span>}</td>
                    <td className="right">{!r.inSync && <Button size="sm" onClick={() => reconcileApply(r.projectId, r.name)}>Repair</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>)}

      <Callout type="info" icon="info" style={{ marginTop: 18 }}>CLI equivalents: <code>npm run storage:integrity</code>, <code>storage:reconcile</code>, <code>storage:cleanup</code>, <code>storage:chunks</code>, <code>storage:purge-trash</code>.</Callout>
    </>
  );
}
