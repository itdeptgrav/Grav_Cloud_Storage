"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { timeAgo } from "@/lib/format";
import { Button, Badge } from "@/components/ui";

function Stat({ label, value }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="muted small">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

export default function IntegrityPage() {
  const [me, setMe] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/api/auth/me").then((d) => setMe(d.user)).catch(() => setMe(false));
  }, []);

  async function run(full) {
    setBusy(true);
    try {
      setReport(await api.get(`/api/admin/integrity${full ? "?full=1" : ""}`));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (me === null) return <p className="muted">Loading…</p>;
  if (!me || me.role !== "superadmin") return <div className="card"><h2>Forbidden</h2><p className="muted">Super-admin only.</p></div>;

  return (
    <>
      <a href="/admin/maintenance" className="muted small">← Maintenance</a>
      <h1 style={{ marginTop: 8 }}>Integrity</h1>
      <p className="muted small">Report-only — scans never delete or modify files. Full check verifies SHA-256 (slower).</p>
      <div className="row" style={{ gap: 8, margin: "12px 0" }}>
        <Button variant="primary" disabled={busy} onClick={() => run(false)}>Run Quick Check</Button>
        <Button disabled={busy} onClick={() => run(true)}>Run Full Check</Button>
        {busy && <span className="spinner" />}
      </div>
      {report && (
        <>
          <div className="grid grid-cards">
            <Stat label="Scan Type" value={report.type} />
            <Stat label="Objects Checked" value={report.checked} />
            <Stat label="Healthy" value={report.healthy} />
            <Stat label="Problems" value={report.problemCount} />
            <Stat label="Duration" value={`${report.durationMs} ms`} />
            <Stat label="Last Scan" value={timeAgo(report.at)} />
          </div>
          {report.problemCount > 0 ? (
            <div className="card" style={{ marginTop: 14, padding: 0, overflowX: "auto" }}>
              <table className="table">
                <thead><tr><th>Type</th><th>File ID</th><th>Details</th></tr></thead>
                <tbody>
                  {report.problems.map((p, i) => (
                    <tr key={i}>
                      <td><Badge kind="revoked">{p.type}</Badge></td>
                      <td className="small mono">{p.fileId || "—"}</td>
                      <td className="small muted">
                        {p.type === "size_mismatch" ? `expected ${p.expected}, actual ${p.actual}` : p.location ? `${p.location}: ${p.storageKey}` : p.status || ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="notice notice-ok" style={{ marginTop: 14 }}>All checked objects are healthy.</div>
          )}
        </>
      )}
    </>
  );
}
