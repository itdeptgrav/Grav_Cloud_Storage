"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { fmtBytes, timeAgo } from "@/lib/format";
import { Button, Badge, PageHeader, EmptyState, Loading, TableSkeleton } from "@/components/ui";

export default function GlobalLogsPage() {
  const [me, setMe] = useState(null);
  const [logs, setLogs] = useState(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [method, setMethod] = useState("");

  useEffect(() => { api.get("/api/auth/me").then((d) => setMe(d.user)).catch(() => setMe(false)); }, []);
  useEffect(() => {
    if (!me || me.role !== "superadmin") return;
    setLogs(null);
    const p = new URLSearchParams({ page: String(page), limit: "50" });
    if (errorsOnly) p.set("errors", "1"); if (method) p.set("method", method);
    api.get(`/api/admin/logs?${p}`).then((d) => { setLogs(d.logs); setTotal(d.total); setHasMore(d.hasMore); }).catch(() => setLogs([]));
  }, [me, page, errorsOnly, method]);
  useEffect(() => { setPage(1); }, [errorsOnly, method]);

  const stClass = (s) => s >= 500 ? "st-5xx" : s >= 400 ? "st-4xx" : s >= 300 ? "st-3xx" : "st-2xx";
  if (me === null) return <Loading />;
  if (!me || me.role !== "superadmin") return <EmptyState icon="shield" title="Super-admin only">You don&apos;t have access to global logs.</EmptyState>;

  return (
    <>
      <PageHeader title="Request Logs" subtitle="Every project's API + dashboard requests. Detailed logs expire per retention; daily rollups persist." />
      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        <select className="select input-sm" value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: "auto" }}><option value="">All methods</option>{["GET", "POST", "HEAD", "DELETE"].map((m) => <option key={m}>{m}</option>)}</select>
        <label className="check check-inline"><input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Errors only</label>
      </div>
      {logs === null && <TableSkeleton rows={8} cols={5} />}
      {logs && logs.length === 0 && <EmptyState icon="logs" title="No requests logged">Requests appear here as they happen.</EmptyState>}
      {logs && logs.length > 0 && (
        <div className="card card-pad-0" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Time</th><th>Method</th><th>Operation</th><th className="num">Status</th><th className="num">Duration</th><th className="num">Transfer</th><th>Actor</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="small muted" title={new Date(l.ts).toLocaleString()}>{timeAgo(l.ts)}</td>
                  <td><span className={`method ${l.method.toLowerCase()}`}>{l.method}</span></td>
                  <td className="small muted">{l.operation}</td>
                  <td className={`small num ${stClass(l.status)}`}>{l.status}{l.errorCode ? <span className="faint tiny"> {l.errorCode}</span> : ""}</td>
                  <td className="small num">{Math.round(l.durationMs)}ms</td>
                  <td className="small num">{fmtBytes((l.bytesIn || 0) + (l.bytesOut || 0))}</td>
                  <td className="small truncate" style={{ maxWidth: 200 }}><Badge kind="neutral">{l.actorType}</Badge> <span className="muted">{l.actor}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {logs && total > 50 && (
        <div className="row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
          <span className="small faint">Page {page} · {total}</span>
          <Button size="sm" icon="chevronLeft" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
          <Button size="sm" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </>
  );
}
