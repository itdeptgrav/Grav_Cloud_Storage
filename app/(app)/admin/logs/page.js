"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { fmtBytes, timeAgo } from "@/lib/format";
import { Button, Badge } from "@/components/ui";

export default function GlobalLogsPage() {
  const [me, setMe] = useState(null);
  const [logs, setLogs] = useState(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [method, setMethod] = useState("");

  useEffect(() => {
    api.get("/api/auth/me").then((d) => setMe(d.user)).catch(() => setMe(false));
  }, []);
  useEffect(() => {
    if (!me || me.role !== "superadmin") return;
    setLogs(null);
    const p = new URLSearchParams({ page: String(page), limit: "50" });
    if (errorsOnly) p.set("errors", "1");
    if (method) p.set("method", method);
    api.get(`/api/admin/logs?${p}`).then((d) => { setLogs(d.logs); setTotal(d.total); setHasMore(d.hasMore); }).catch(() => setLogs([]));
  }, [me, page, errorsOnly, method]);
  useEffect(() => { setPage(1); }, [errorsOnly, method]);

  if (me === null) return <p className="muted">Loading…</p>;
  if (!me || me.role !== "superadmin") return <div className="card"><h2>Forbidden</h2><p className="muted">Super-admin only.</p></div>;

  return (
    <>
      <h1>Global request logs</h1>
      <p className="muted small">Every project's API + dashboard requests. Detailed logs expire per retention; daily rollups persist.</p>
      <div className="toolbar">
        <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">All methods</option>{["GET", "POST", "HEAD", "DELETE"].map((m) => <option key={m}>{m}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Errors only</label>
      </div>
      {logs === null && <div className="state"><span className="spinner" /> Loading…</div>}
      {logs && logs.length === 0 && <div className="state">No requests logged yet.</div>}
      {logs && logs.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Time</th><th>Actor</th><th>Method</th><th>Operation</th><th>Status</th><th>ms</th><th>Transferred</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="small muted" title={new Date(l.ts).toLocaleString()}>{timeAgo(l.ts)}</td>
                  <td className="small"><Badge>{l.actorType}</Badge> {l.actor}</td>
                  <td className="small">{l.method}</td>
                  <td className="small muted">{l.operation}</td>
                  <td className="small"><span style={{ color: l.status >= 400 ? "var(--down)" : "var(--up)" }}>{l.status}</span>{l.errorCode ? ` ${l.errorCode}` : ""}</td>
                  <td className="small">{Math.round(l.durationMs)}</td>
                  <td className="small">{fmtBytes((l.bytesIn || 0) + (l.bytesOut || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {logs && total > 50 && (
        <div className="row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
          <span className="small muted">Page {page} · {total}</span>
          <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
          <Button size="sm" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </>
  );
}
