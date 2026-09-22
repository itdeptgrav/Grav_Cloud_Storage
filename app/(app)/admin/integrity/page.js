"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { timeAgo } from "@/lib/format";
import { Button, Badge, StatCard, PageHeader, EmptyState, Loading, Callout, toast } from "@/components/ui";

export default function IntegrityPage() {
  const [me, setMe] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get("/api/auth/me").then((d) => setMe(d.user)).catch(() => setMe(false)); }, []);

  async function run(full) {
    setBusy(true);
    try { setReport(await api.get(`/api/admin/integrity${full ? "?full=1" : ""}`)); toast.success(full ? "Full check complete" : "Quick check complete"); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }

  if (me === null) return <Loading />;
  if (!me || me.role !== "superadmin") return <EmptyState icon="shield" title="Super-admin only">You don&apos;t have access to the integrity checker.</EmptyState>;

  return (
    <>
      <PageHeader title="Integrity" subtitle="Report-only — scans never delete or modify files. Full check verifies SHA-256 (slower)."
        back={{ href: "/admin/maintenance", label: "Maintenance" }}
        actions={<><Button variant="primary" loading={busy} icon="shield" onClick={() => run(false)}>Quick check</Button><Button loading={busy} onClick={() => run(true)}>Full check</Button></>} />

      {!report ? (
        <Callout type="info" icon="info">Run a check to scan every object against its metadata. Quick verifies presence and size; Full also verifies SHA-256 checksums.</Callout>
      ) : (
        <>
          <div className="grid grid-stats">
            <StatCard label="Scan type" value={report.type} />
            <StatCard label="Checked" value={report.checked} />
            <StatCard label="Healthy" value={report.healthy} />
            <StatCard label="Problems" value={report.problemCount} />
            <StatCard label="Duration" value={`${report.durationMs} ms`} />
            <StatCard label="Ran" value={timeAgo(report.at)} />
          </div>
          {report.problemCount > 0 ? (
            <div className="card card-pad-0 mt-2" style={{ overflowX: "auto" }}>
              <table className="table">
                <thead><tr><th>Type</th><th>File ID</th><th>Details</th></tr></thead>
                <tbody>
                  {report.problems.map((p, i) => (
                    <tr key={i}>
                      <td><Badge kind="danger">{p.type}</Badge></td>
                      <td className="small mono">{p.fileId || "—"}</td>
                      <td className="small muted">{p.type === "size_mismatch" ? `expected ${p.expected}, actual ${p.actual}` : p.location ? `${p.location}: ${p.storageKey}` : p.status || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Callout type="ok" icon="checkCircle" style={{ marginTop: 14 }}>All {report.checked} checked objects are healthy — 0 problems.</Callout>}
        </>
      )}
    </>
  );
}
