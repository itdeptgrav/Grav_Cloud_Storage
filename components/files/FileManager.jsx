"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/clientApi";
import { uploadFileXHR } from "@/lib/uploadClient";
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

  const startUploads = useCallback((fileList) => {
    const arr = Array.from(fileList || []);
    if (!arr.length) return;
    if (trash) setTrash(false);
    for (const f of arr) {
      const item = { id: ++uid, name: f.name, size: f.size, loaded: 0, status: "uploading", error: null };
      setUploads((u) => [item, ...u]);
      uploadFileXHR(projectId, f, {
        onProgress: (loaded) => setUploads((u) => u.map((x) => (x.id === item.id ? { ...x, loaded } : x))),
        onDone: (res) => {
          setUploads((u) => u.map((x) => (x.id === item.id ? { ...x, status: res.ok ? "done" : "error", error: res.error, loaded: res.ok ? f.size : x.loaded } : x)));
          if (res.ok) { toast.success(`Uploaded ${f.name}`); load(); onChanged && onChanged(); }
          else toast.error(`Upload failed: ${res.error || f.name}`);
        },
      });
    }
  }, [projectId, trash, load, onChanged]);

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
      {uploads.length > 0 && (
        <div className="upload-tray">
          <div className="between" style={{ marginBottom: 6 }}>
            <span className="small strong">{activeUploads ? `Uploading ${activeUploads} file${activeUploads > 1 ? "s" : ""}…` : "Uploads"}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setUploads((u) => u.filter((x) => x.status === "uploading"))}>Clear finished</button>
          </div>
          {uploads.map((u) => {
            const pct = u.size ? Math.min(100, (u.loaded / u.size) * 100) : 0;
            return (
              <div key={u.id} className="upload-item">
                <Icon name={u.status === "done" ? "checkCircle" : u.status === "error" ? "alertCircle" : "upload"} size={16}
                  style={{ color: u.status === "done" ? "var(--success)" : u.status === "error" ? "var(--danger)" : "var(--muted)" }} />
                <span className="truncate small">{u.name}</span>
                <span className="small" style={{ color: u.status === "error" ? "var(--down)" : u.status === "done" ? "var(--up)" : "var(--muted)" }}>
                  {u.status === "error" ? (u.error || "Failed") : u.status === "done" ? "Done" : `${pct.toFixed(0)}%`}
                </span>
                {u.status === "uploading" && <div className="progress ui-prog"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>}
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
