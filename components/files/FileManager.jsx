"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/clientApi";
import { uploadFileXHR, resumeChunkedUpload, listPendingUploads, pendingUploadStatus, discardPendingUpload, forgetPendingUpload, fingerprintOf, CHUNK_THRESHOLD } from "@/lib/uploadClient";
import { fmtBytes, timeAgo, fmtDate } from "@/lib/format";
import { Button, IconButton, SearchInput, Select, Dropdown, MenuItem, EmptyState, TableSkeleton, confirmAction, toast, copyText } from "@/components/ui";
import Icon from "@/components/icons";
import FileDetail from "@/components/files/FileDetail";

const FILTERS = [["", "All"], ["images", "Images"], ["videos", "Videos"], ["documents", "Documents"], ["audio", "Audio"], ["archives", "Archives"], ["other", "Other"]];
const SORTS = [["-createdAt", "Newest"], ["createdAt", "Oldest"], ["name", "Name A–Z"], ["-name", "Name Z–A"], ["-size", "Largest"], ["size", "Smallest"]];
const LIMIT = 20;
let uid = 0;

function typeLabel(file) {
  if (file.extension) return file.extension;
  const m = file.mimeType || "";
  return m.split("/")[1]?.slice(0, 4) || m.split("/")[0] || "bin";
}
function fileIcon(m = "") {
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "music";
  if (/zip|tar|gzip|rar|7z|compress/.test(m)) return "archive";
  if (/pdf|text|json|xml|word|document|sheet/.test(m)) return "fileText";
  return "file";
}
const isImage = (m) => m && m.startsWith("image/") && m !== "image/svg+xml";
function fmtDuration(sec) {
  if (!isFinite(sec) || sec < 0) return "—";
  sec = Math.round(sec);
  if (sec < 60) return `${sec} sec`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min ${sec % 60} sec`;
  return `${Math.floor(sec / 3600)} hr ${Math.floor((sec % 3600) / 60)} min`;
}
// Human text for a chunked upload's phase (from the client's onState).
function phaseText(u) {
  const n = u.totalChunks ? `${Math.min((u.chunkIndex ?? 0) + 1, u.totalChunks)}` : "";
  switch (u.phase) {
    case "preparing": return "Preparing…";
    case "verifying": return `Checking the already-uploaded part (chunk ${n}/${u.totalChunks})…`;
    case "retrying": return `Retrying chunk ${n}/${u.totalChunks}${u.reason ? ` — ${u.reason}` : ""} · attempt ${u.attempt}/${u.maxAttempts || "?"}${u.nextRetryInMs ? ` (next try in ${Math.ceil(u.nextRetryInMs / 1000)} s)` : ""}`;
    case "paused": return "Paused";
    case "interrupted": return `Upload paused after ${u.maxAttempts || "several"} failed attempts at chunk ${n}${u.reason ? ` — last error: ${u.reason}` : ""}. Accepted chunks are kept; Retry sends only chunk ${n}.`;
    case "finalizing": return "Verifying checksums & finalizing…";
    default: return "";
  }
}

export default function FileManager({ projectId, onChanged }) {
  const [files, setFiles] = useState(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("-createdAt");
  const [view, setView] = useState("list");
  const [trash, setTrash] = useState(false);
  const [uploads, setUploads] = useState([]);
  const [detail, setDetail] = useState(null);
  const [menu, setMenu] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const inputRef = useRef(null);

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    setFiles(null);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT), sort });
    if (dq) params.set("search", dq);
    if (type) params.set("type", type);
    if (trash) params.set("status", "trashed");
    try {
      const d = await api.get(`/api/dashboard/projects/${projectId}/files?${params}`);
      setFiles(d.files); setTotal(d.total); setHasMore(d.hasMore);
    } catch { setFiles([]); setTotal(0); }
  }, [projectId, page, dq, type, sort, trash]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [dq, type, sort, trash]);

  const controllers = useRef(new Map()); // upload item id -> { pause, resume, cancel }
  const uploadsRef = useRef([]);
  useEffect(() => { uploadsRef.current = uploads; }, [uploads]);
  const resumeInputRef = useRef(null);
  const resumeTarget = useRef(null); // the "needs-file" item waiting for its file
  const patch = (id, p) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...(typeof p === "function" ? p(x) : p) } : x)));

  // After a page reload: offer to resume chunked uploads this browser started.
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const entry of listPendingUploads(projectId)) {
        const s = await pendingUploadStatus(projectId, entry);
        if (!alive) return;
        if (!s || s.status !== "active") { forgetPendingUpload(projectId, entry.fingerprint); continue; }
        setUploads((u) => (u.some((x) => x.fingerprint === entry.fingerprint) ? u : [{
          id: ++uid, name: entry.name, size: entry.size, loaded: s.bytesReceived, status: "needs-file", phase: "paused",
          chunked: true, fingerprint: entry.fingerprint, entry, chunkIndex: s.nextIndex, totalChunks: s.totalChunks,
          speed: 0, avgSpeed: 0, eta: null, error: null,
        }, ...u]));
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  // Start (or resume) one upload and wire its progress/state into the tray.
  const launch = useCallback((f, { resume = false, reuseId = null } = {}) => {
    const id = reuseId ?? ++uid;
    const startedAt = performance.now();
    const row = {
      id, name: f.name, size: f.size, loaded: 0, status: "uploading", phase: "preparing", error: null, speed: 0, avgSpeed: 0, eta: null,
      fingerprint: fingerprintOf(f), chunked: f.size > CHUNK_THRESHOLD, chunkIndex: 0, totalChunks: 0, attempt: 0,
      stats: null, reason: null, maxAttempts: 0, nextRetryInMs: 0,
    };
    if (reuseId != null) patch(id, row);
    else setUploads((u) => [row, ...u]);
    const samples = [];
    let startLoaded = null; // a resumed upload starts part-way through the file
    let lastUi = 0;
    let lastStatsUi = 0;
    const callbacks = {
      // Chunked uploads: committed vs re-sent bytes, current vs effective speed.
      onStats: (stats) => {
        const now = performance.now();
        if (now - lastStatsUi > 250 || stats.committed >= f.size) {
          lastStatsUi = now;
          patch(id, { stats });
        }
      },
      onProgress: (loaded) => {
        const now = performance.now();
        if (startLoaded == null) startLoaded = loaded;
        samples.push({ t: now, loaded });
        while (samples.length > 2 && samples[0].t < now - 3000) samples.shift(); // 3s moving window
        const win = samples[0];
        const speed = now > win.t ? Math.max(0, ((loaded - win.loaded) / (now - win.t)) * 1000) : 0; // bytes/s
        const avgSpeed = now > startedAt ? Math.max(0, ((loaded - startLoaded) / (now - startedAt)) * 1000) : 0;
        const eta = speed > 0 ? (f.size - loaded) / speed : null; // seconds
        if (now - lastUi > 200 || loaded >= f.size) { // throttle re-renders → the page stays smooth
          lastUi = now;
          patch(id, { loaded, speed, avgSpeed, eta });
        }
      },
      onState: (phase, info = {}) => patch(id, (x) => ({
        phase,
        totalChunks: info.totalChunks || x.totalChunks,
        chunkIndex: info.index != null ? info.index : x.chunkIndex,
        attempt: info.attempt || 0,
        maxAttempts: info.maxAttempts || x.maxAttempts,
        reason: info.reason !== undefined ? info.reason : x.reason,
        nextRetryInMs: info.nextRetryInMs || 0,
        ...(phase === "paused" || phase === "interrupted" ? { speed: 0, eta: null } : {}),
      })),
      onDone: (res) => {
        controllers.current.delete(id);
        const status = res.ok ? "done" : res.cancelled ? "cancelled" : res.interrupted ? "interrupted" : "error";
        const hint = !res.ok && res.resumable && res.code !== "FILE_MISMATCH" ? " — add the same file again to resume" : "";
        patch(id, { status, phase: status, error: res.ok ? null : `${res.error || "Failed"}${hint}`, speed: 0, eta: null, ...(res.ok ? { loaded: f.size } : {}) });
        if (res.ok) { toast.success(`Uploaded ${f.name}`); load(); onChanged && onChanged(); }
        else if (res.cancelled) toast.info(`Cancelled ${f.name}`);
        else if (status === "interrupted") toast.error(`Upload interrupted: ${f.name}`);
        else toast.error(`Upload failed: ${res.error || f.name}`);
      },
    };
    controllers.current.set(id, resume ? resumeChunkedUpload(projectId, f, callbacks) : uploadFileXHR(projectId, f, callbacks));
  }, [projectId, load, onChanged]);

  const startUploads = useCallback((fileList) => {
    const arr = Array.from(fileList || []);
    if (!arr.length) return;
    if (trash) setTrash(false);
    const seen = new Set();
    for (const f of arr) {
      const fp = fingerprintOf(f);
      if (seen.has(fp)) continue; // the same file twice in one drop
      seen.add(fp);
      const existing = uploadsRef.current.find((x) => x.fingerprint === fp && (x.status === "uploading" || x.status === "needs-file"));
      if (existing?.status === "uploading") { toast.info(`${f.name} is already uploading`); continue; }
      if (existing?.status === "needs-file") { launch(f, { resume: true, reuseId: existing.id }); continue; } // dropping it again resumes
      launch(f);
    }
  }, [trash, launch]);

  function pickResumeFile(item) { resumeTarget.current = item; resumeInputRef.current?.click(); }
  function onResumeFile(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    const item = resumeTarget.current;
    resumeTarget.current = null;
    if (!f || !item) return;
    if (fingerprintOf(f) !== item.fingerprint) { toast.error(`That isn't ${item.name}. Pick the same file to resume.`); return; }
    launch(f, { resume: true, reuseId: item.id });
  }
  async function discardUpload(item) {
    const ok = await confirmAction({ title: "Discard this upload?", danger: true, body: `The ${fmtBytes(item.loaded)} already uploaded for “${item.name}” will be deleted.`, confirmLabel: "Discard" });
    if (!ok) return;
    await discardPendingUpload(projectId, item.entry || { fingerprint: item.fingerprint });
    setUploads((u) => u.filter((x) => x.id !== item.id));
  }
  async function cancelUpload(item) {
    const ok = await confirmAction({ title: "Cancel this upload?", danger: true, body: `Uploading “${item.name}” stops and the part already sent is deleted.`, confirmLabel: "Cancel upload" });
    if (ok) controllers.current.get(item.id)?.cancel();
  }

  // full-page drag overlay
  function onDragEnter(e) { e.preventDefault(); if (trash) return; dragDepth.current++; setDragging(true); }
  function onDragLeave(e) { e.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) { setDragging(false); dragDepth.current = 0; } }
  function onDrop(e) { e.preventDefault(); dragDepth.current = 0; setDragging(false); if (e.dataTransfer?.files?.length) startUploads(e.dataTransfer.files); }

  async function del(file) {
    setMenu(null);
    const ok = await confirmAction({ title: "Move to trash?", subject: { icon: typeLabel(file), name: file.name, meta: fmtBytes(file.sizeBytes) }, body: "The file is moved to trash and stops counting toward your quota. You can restore it before it is purged.", confirmLabel: "Move to trash" });
    if (!ok) return;
    try { await api.del(`/api/dashboard/projects/${projectId}/files/${file.fileId}`); toast.success("Moved to trash"); load(); onChanged && onChanged(); }
    catch (e) { toast.error(e.message); }
  }
  async function copyId(file) {
    setMenu(null);
    (await copyText(file.fileId)) ? toast.success("File ID copied") : toast.error("Could not copy");
  }
  async function restore(file) {
    try { await api.post(`/api/dashboard/projects/${projectId}/files/${file.fileId}/restore`); toast.success("File restored"); load(); onChanged && onChanged(); }
    catch (e) { toast.error(e.message); }
  }
  async function purge(file) {
    const ok = await confirmAction({ title: "Delete forever?", danger: true, subject: { icon: typeLabel(file), name: file.name, meta: fmtBytes(file.sizeBytes) }, body: "This permanently removes the file bytes from storage. This action cannot be undone.", confirmLabel: "Delete forever" });
    if (!ok) return;
    try { await api.del(`/api/dashboard/projects/${projectId}/files/${file.fileId}/purge`); toast.success("File permanently deleted"); load(); onChanged && onChanged(); }
    catch (e) { toast.error(e.message); }
  }

  const activeUploads = uploads.filter((u) => u.status === "uploading").length;
  const dl = (f) => `/api/dashboard/projects/${projectId}/files/${f.fileId}/download`;

  return (
    <div onDragEnter={onDragEnter} onDragOver={(e) => e.preventDefault()} onDragLeave={onDragLeave} onDrop={onDrop}>
      {dragging && (
        <div className="drop-overlay">
          <div className="box"><Icon name="upload" /><div style={{ fontSize: 16, fontWeight: 600 }}>Drop files to upload</div><div className="muted small mt-1">Release to add them to this project</div></div>
        </div>
      )}

      {/* toolbar */}
      <div className="between wrap" style={{ marginBottom: 16, gap: 10 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          {FILTERS.map(([val, label]) => (
            <button key={val} className={`btn btn-sm ${type === val && !trash ? "btn-primary" : "btn-subtle"}`} onClick={() => { setTrash(false); setType(val); }}>{label}</button>
          ))}
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <SearchInput placeholder="Search files…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 190 }} />
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="input-sm" style={{ width: "auto" }}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <div className="segmented">
            <button className={view === "list" ? "on" : ""} onClick={() => setView("list")} aria-label="List view"><Icon name="list" /></button>
            <button className={view === "grid" ? "on" : ""} onClick={() => setView("grid")} aria-label="Grid view"><Icon name="grid" /></button>
          </div>
          <Button size="sm" variant={trash ? "primary" : "subtle"} icon="trash" onClick={() => setTrash((t) => !t)}>{trash ? "Back to files" : "Trash"}</Button>
          {!trash && (<>
            <input ref={inputRef} type="file" multiple hidden onChange={(e) => { startUploads(e.target.files); e.target.value = ""; }} />
            <Button size="sm" variant="primary" icon="upload" onClick={() => inputRef.current?.click()}>Upload</Button>
          </>)}
        </div>
      </div>

      {/* upload tray */}
      <input ref={resumeInputRef} type="file" hidden onChange={onResumeFile} />
      {uploads.length > 0 && (
        <div className="upload-tray">
          <div className="between" style={{ marginBottom: 6 }}>
            <span className="small strong">{activeUploads ? `Uploading ${activeUploads} file${activeUploads > 1 ? "s" : ""}…` : "Uploads"}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setUploads((u) => u.filter((x) => x.status === "uploading" || x.status === "needs-file"))}>Clear finished</button>
          </div>
          {uploads.map((u) => {
            const pct = u.size ? Math.min(100, (u.loaded / u.size) * 100) : 0;
            const done = u.status === "done", failed = u.status === "error", interrupted = u.status === "interrupted";
            const cancelled = u.status === "cancelled", uploading = u.status === "uploading", needsFile = u.status === "needs-file";
            const halted = uploading && (u.phase === "paused" || u.phase === "interrupted");
            const statusColor = done ? "var(--up)" : failed || interrupted || u.phase === "interrupted" ? "var(--down)" : "var(--muted)";
            const chunkLabel = u.chunked && u.totalChunks ? ` · chunk ${Math.min((u.chunkIndex ?? 0) + 1, u.totalChunks)}/${u.totalChunks}` : "";
            const note = phaseText(u);
            return (
              <div key={u.id} className="upload-item" style={{ display: "block" }}>
                <div className="between" style={{ gap: 8 }}>
                  <span className="row" style={{ gap: 8, minWidth: 0 }}>
                    <Icon name={done ? "checkCircle" : failed || interrupted ? "alertCircle" : halted || needsFile ? "pause" : "upload"} size={16} style={{ color: statusColor, flex: "none" }} />
                    <span className="truncate small strong" title={u.name}>{u.name}</span>
                    <span className="faint tiny" style={{ flex: "none" }}>{fmtBytes(u.size)}</span>
                  </span>
                  <span className="small" style={{ color: statusColor, flex: "none" }}>
                    {done ? "Done" : cancelled ? "Cancelled" : interrupted ? "Interrupted" : failed ? "Failed" : `${pct.toFixed(0)}%${chunkLabel}`}
                  </span>
                </div>
                {(uploading || needsFile) && (
                  <>
                    <div className="progress ui-prog" style={{ margin: "7px 0 5px" }}><div className="progress-bar" style={{ width: `${pct}%`, opacity: halted || needsFile ? 0.5 : 1 }} /></div>
                    {u.chunked && u.stats ? (
                      <>
                        <div className="between faint tiny" style={{ gap: 8 }}>
                          {/* Only bytes the server ACCEPTED count as uploaded. */}
                          <span>{fmtBytes(u.stats.committed)} / {fmtBytes(u.size)} uploaded</span>
                          {uploading && !halted && u.phase !== "verifying" && u.phase !== "finalizing" && (
                            <span>
                              Current {u.stats.currentBps ? `${fmtBytes(u.stats.currentBps)}/s` : "…"}
                              {` · Effective ${u.stats.effectiveBps ? `${fmtBytes(u.stats.effectiveBps)}/s` : "…"}`}
                              {u.stats.etaSec != null && isFinite(u.stats.etaSec) ? ` · ~${fmtDuration(u.stats.etaSec)} left` : ""}
                            </span>
                          )}
                        </div>
                        {(u.stats.retries > 0 || u.stats.retransmitted > 0) && (
                          <div className="faint tiny" style={{ marginTop: 2 }}>
                            Retries {u.stats.retries} · Re-sent {fmtBytes(u.stats.retransmitted)} (not counted as uploaded)
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="between faint tiny" style={{ gap: 8 }}>
                        <span>{fmtBytes(u.loaded)} / {fmtBytes(u.size)}</span>
                        {uploading && !halted && u.phase !== "verifying" && u.phase !== "finalizing" && (
                          <span>
                            {u.speed ? `${fmtBytes(u.speed)}/s` : "…"}
                            {u.avgSpeed ? ` · avg ${fmtBytes(u.avgSpeed)}/s` : ""}
                            {u.eta != null && isFinite(u.eta) ? ` · ~${fmtDuration(u.eta)} left` : ""}
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
                {uploading && note && <div className="tiny" style={{ marginTop: 3, color: u.phase === "interrupted" || u.phase === "retrying" ? "var(--warn, var(--down))" : "var(--muted)" }}>{note}</div>}
                {needsFile && <div className="tiny muted" style={{ marginTop: 3 }}>Paused by a page reload — select the same file to resume from {fmtBytes(u.loaded)}.</div>}
                {(failed || interrupted) && u.error && <div className="tiny" style={{ marginTop: 3, color: "var(--down)" }}>{u.error}</div>}
                {u.chunked && (uploading || needsFile) && (
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    {needsFile && <Button size="sm" variant="primary" icon="upload" onClick={() => pickResumeFile(u)}>Select file to resume</Button>}
                    {needsFile && <Button size="sm" variant="subtle" icon="trash" onClick={() => discardUpload(u)}>Discard</Button>}
                    {uploading && !halted && u.phase !== "finalizing" && <Button size="sm" variant="subtle" icon="pause" onClick={() => controllers.current.get(u.id)?.pause()}>Pause</Button>}
                    {uploading && halted && <Button size="sm" variant="primary" icon="play" onClick={() => controllers.current.get(u.id)?.resume()}>{u.phase === "interrupted" ? "Retry" : "Resume"}</Button>}
                    {uploading && u.phase !== "finalizing" && <Button size="sm" variant="subtle" icon="x" onClick={() => cancelUpload(u)}>Cancel</Button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* loading */}
      {files === null && <TableSkeleton rows={6} cols={5} />}

      {/* empty */}
      {files && files.length === 0 && (
        trash
          ? <EmptyState icon="trash" title="Trash is empty">Deleted files appear here and can be restored before they are purged.</EmptyState>
          : (dq || type)
            ? <EmptyState icon="search" title="No matching files">Try a different search term or filter.</EmptyState>
            : <EmptyState icon="upload" title="No files yet" action={<Button variant="primary" icon="upload" onClick={() => inputRef.current?.click()}>Upload files</Button>}>Upload your first file, or drag and drop it anywhere on this page.</EmptyState>
      )}

      {/* active list */}
      {files && files.length > 0 && !trash && view === "list" && (
        <div className="card card-pad-0" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Name</th><th>Type</th><th className="num">Size</th><th>Uploaded</th><th className="num">Downloads</th><th>Uploaded by</th><th></th></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.fileId} className="row-click">
                  <td onClick={() => setDetail(f)}><div className="name-cell"><Icon name={fileIcon(f.mimeType)} size={16} style={{ color: "var(--muted-2)", flex: "none" }} /><span className="nm truncate" title={f.name}>{f.name}</span></div></td>
                  <td className="small muted" onClick={() => setDetail(f)}><span className="ftype">{typeLabel(f)}</span></td>
                  <td className="small num" onClick={() => setDetail(f)}>{fmtBytes(f.sizeBytes)}</td>
                  <td className="small muted" onClick={() => setDetail(f)} title={new Date(f.createdAt).toLocaleString()}>{timeAgo(f.createdAt)}</td>
                  <td className="small num" onClick={() => setDetail(f)}>{f.downloads}</td>
                  <td className="small muted truncate" onClick={() => setDetail(f)} style={{ maxWidth: 160 }}>{f.uploadedByLabel || "—"}</td>
                  <td className="right">
                    <div className="kebab">
                      <IconButton name="kebab" label="Actions" onClick={(e) => { e.stopPropagation(); setMenu(menu === f.fileId ? null : f.fileId); }} />
                      <Dropdown open={menu === f.fileId} onClose={() => setMenu(null)}>
                        <MenuItem icon="eye" onClick={() => { setMenu(null); setDetail(f); }}>Preview / details</MenuItem>
                        <MenuItem icon="copy" onClick={() => copyId(f)}>Copy File ID</MenuItem>
                        <a href={dl(f)} onClick={() => setMenu(null)}><Icon name="download" size={14} />Download</a>
                        <div className="sep" />
                        <MenuItem icon="trash" danger onClick={() => del(f)}>Move to trash</MenuItem>
                      </Dropdown>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* active grid */}
      {files && files.length > 0 && !trash && view === "grid" && (
        <div className="grid-files">
          {files.map((f) => (
            <div key={f.fileId} className="file-card" onClick={() => setDetail(f)}>
              <div className="thumb">
                {isImage(f.mimeType)
                  ? <img src={`/api/dashboard/projects/${projectId}/files/${f.fileId}/raw`} alt={f.name} loading="lazy" />
                  : <Icon name={fileIcon(f.mimeType)} size={30} style={{ color: "var(--muted-2)" }} />}
              </div>
              <div className="cap">
                <div className="nm small truncate" title={f.name}>{f.name}</div>
                <div className="faint tiny" style={{ marginTop: 2 }}>{fmtBytes(f.sizeBytes)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* trash */}
      {files && files.length > 0 && trash && (
        <div className="card card-pad-0" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Name</th><th className="num">Size</th><th>Deleted</th><th></th></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.fileId}>
                  <td><div className="name-cell"><Icon name={fileIcon(f.mimeType)} size={16} style={{ color: "var(--muted-2)" }} /><span className="nm truncate" title={f.name}>{f.name}</span></div></td>
                  <td className="small num">{fmtBytes(f.sizeBytes)}</td>
                  <td className="small muted" title={f.trashedAt ? new Date(f.trashedAt).toLocaleString() : ""}>{f.trashedAt ? timeAgo(f.trashedAt) : "—"}</td>
                  <td className="right"><div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                    <Button size="sm" icon="refresh" onClick={() => restore(f)}>Restore</Button>
                    <Button size="sm" variant="danger" icon="trash" onClick={() => purge(f)}>Delete forever</Button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* pagination */}
      {files && total > LIMIT && (
        <div className="row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
          <span className="small faint">Page {page} · {total} files</span>
          <Button size="sm" icon="chevronLeft" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
          <Button size="sm" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}

      {detail && <FileDetail projectId={projectId} file={detail} onClose={() => setDetail(null)} onDeleted={() => { load(); onChanged && onChanged(); }} />}
    </div>
  );
}
