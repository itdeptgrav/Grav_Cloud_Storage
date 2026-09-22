"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/clientApi";
import { uploadFileXHR } from "@/lib/uploadClient";
import { fmtBytes, timeAgo, fmtDate } from "@/lib/format";
import { Button } from "@/components/ui";
import FileDetail from "@/components/files/FileDetail";

const FILTERS = [
  ["", "All"],
  ["images", "Images"],
  ["videos", "Videos"],
  ["documents", "Documents"],
  ["audio", "Audio"],
  ["archives", "Archives"],
  ["other", "Other"],
];
const SORTS = [
  ["-createdAt", "Newest"],
  ["createdAt", "Oldest"],
  ["name", "Name A–Z"],
  ["-name", "Name Z–A"],
  ["-size", "Largest"],
  ["size", "Smallest"],
];
const LIMIT = 20;
let uid = 0;

function typeLabel(file) {
  if (file.extension) return file.extension;
  const m = file.mimeType || "";
  return m.split("/")[1]?.slice(0, 4) || m.split("/")[0] || "bin";
}
function isImage(m) {
  return m && m.startsWith("image/") && m !== "image/svg+xml";
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
  const inputRef = useRef(null);

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setFiles(null);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT), sort });
    if (dq) params.set("search", dq);
    if (type) params.set("type", type);
    if (trash) params.set("status", "trashed");
    try {
      const d = await api.get(`/api/dashboard/projects/${projectId}/files?${params}`);
      setFiles(d.files);
      setTotal(d.total);
      setHasMore(d.hasMore);
    } catch {
      setFiles([]);
      setTotal(0);
    }
  }, [projectId, page, dq, type, sort, trash]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setPage(1);
  }, [dq, type, sort, trash]);

  // ── uploads ──
  const startUploads = useCallback(
    (fileList) => {
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
            if (res.ok) {
              load();
              onChanged && onChanged();
            }
          },
        });
      }
    },
    [projectId, trash, load, onChanged],
  );

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) startUploads(e.dataTransfer.files);
  }

  async function del(file) {
    setMenu(null);
    if (!window.confirm(`Move "${file.name}" to Trash?`)) return;
    try {
      await api.del(`/api/dashboard/projects/${projectId}/files/${file.fileId}`);
      load();
      onChanged && onChanged();
    } catch (e) {
      alert(e.message);
    }
  }
  function copyId(file) {
    setMenu(null);
    try {
      navigator.clipboard.writeText(file.fileId);
    } catch {
      /* blocked */
    }
  }

  const activeUploads = uploads.filter((u) => u.status === "uploading").length;

  return (
    <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      {/* toolbar */}
      <div className="toolbar">
        <div className="chips">
          {FILTERS.map(([val, label]) => (
            <button key={val} className={`chip ${type === val && !trash ? "chip-active" : ""}`} onClick={() => { setTrash(false); setType(val); }}>
              {label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <input className="input input-sm" placeholder="Search files…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} />
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="view-toggle">
          <button className={view === "list" ? "on" : ""} onClick={() => setView("list")} title="List">≣</button>
          <button className={view === "grid" ? "on" : ""} onClick={() => setView("grid")} title="Grid">▦</button>
        </div>
        <button className={`btn btn-sm ${trash ? "btn-primary" : ""}`} onClick={() => setTrash((t) => !t)}>{trash ? "← Files" : "Trash"}</button>
        {!trash && (
          <>
            <input ref={inputRef} type="file" multiple hidden onChange={(e) => startUploads(e.target.files)} />
            <Button variant="primary" size="sm" onClick={() => inputRef.current?.click()}>Upload Files</Button>
          </>
        )}
      </div>

      {/* dropzone hint */}
      {!trash && (
        <div className={`dropzone ${dragging ? "drag" : ""}`} style={{ marginBottom: 14 }} onClick={() => inputRef.current?.click()}>
          Drag &amp; drop files here, or click to choose. Multiple files supported.
        </div>
      )}

      {/* upload tray */}
      {uploads.length > 0 && (
        <div className="upload-tray">
          <div className="between" style={{ marginBottom: 4 }}>
            <span className="small muted">{activeUploads ? `Uploading ${activeUploads}…` : "Uploads"}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setUploads((u) => u.filter((x) => x.status === "uploading"))}>Clear finished</button>
          </div>
          {uploads.map((u) => {
            const pct = u.size ? Math.min(100, (u.loaded / u.size) * 100) : 0;
            return (
              <div key={u.id} className="upload-item">
                <span className="nm mono small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
                <span className="small" style={{ color: u.status === "error" ? "var(--down)" : u.status === "done" ? "var(--up)" : "var(--muted)" }}>
                  {u.status === "error" ? u.error : u.status === "done" ? "Done" : `${fmtBytes(u.loaded)} / ${fmtBytes(u.size)} · ${pct.toFixed(0)}%`}
                </span>
                <div className="progress"><div className="progress-bar" style={{ width: `${u.status === "done" ? 100 : pct}%`, background: u.status === "error" ? "var(--down)" : undefined }} /></div>
              </div>
            );
          })}
        </div>
      )}

      {/* list */}
      {files === null && <div className="state"><span className="spinner" /> Loading files…</div>}
      {files && files.length === 0 && (
        <div className="state">
          {trash ? "Trash is empty." : dq || type ? "No files match your search/filter." : "No files yet. Upload your first file."}
        </div>
      )}

      {files && files.length > 0 && !trash && view === "list" && (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Type</th><th>Size</th><th>Uploaded</th><th>Downloads</th><th>Uploaded By</th><th></th></tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.fileId} style={{ cursor: "pointer" }}>
                  <td onClick={() => setDetail(f)}>
                    <div className="name-cell"><span className="ftype">{typeLabel(f)}</span><span className="nm">{f.name}</span></div>
                  </td>
                  <td className="small muted" onClick={() => setDetail(f)}>{f.mimeType}</td>
                  <td className="small" onClick={() => setDetail(f)}>{fmtBytes(f.sizeBytes)}</td>
                  <td className="small muted" onClick={() => setDetail(f)} title={new Date(f.createdAt).toLocaleString()}>{timeAgo(f.createdAt)}</td>
                  <td className="small" onClick={() => setDetail(f)}>{f.downloads}</td>
                  <td className="small muted" onClick={() => setDetail(f)}>{f.uploadedByLabel || "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <div className="kebab">
                      <button className="btn btn-ghost btn-sm" onClick={() => setMenu(menu === f.fileId ? null : f.fileId)}>⋯</button>
                      {menu === f.fileId && (
                        <div className="menu" onMouseLeave={() => setMenu(null)}>
                          <button onClick={() => { setMenu(null); setDetail(f); }}>Preview / Details</button>
                          <button onClick={() => copyId(f)}>Copy File ID</button>
                          <a href={`/api/dashboard/projects/${projectId}/files/${f.fileId}/download`} onClick={() => setMenu(null)}>Download</a>
                          <button className="danger" onClick={() => del(f)}>Delete</button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {files && files.length > 0 && !trash && view === "grid" && (
        <div className="grid-files">
          {files.map((f) => (
            <div key={f.fileId} className="file-card" onClick={() => setDetail(f)}>
              <div className="thumb">
                {isImage(f.mimeType) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/dashboard/projects/${projectId}/files/${f.fileId}/raw`} alt={f.name} />
                ) : (
                  <span className="ftype" style={{ fontSize: 14, height: 34, minWidth: 48 }}>{typeLabel(f)}</span>
                )}
              </div>
              <div className="cap">
                <div className="nm small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                <div className="muted small">{fmtBytes(f.sizeBytes)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* trash view (read-only) */}
      {files && files.length > 0 && trash && (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Name</th><th>Size</th><th>Deleted At</th></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.fileId}>
                  <td><div className="name-cell"><span className="ftype">{typeLabel(f)}</span><span className="nm">{f.name}</span></div></td>
                  <td className="small">{fmtBytes(f.sizeBytes)}</td>
                  <td className="small muted" title={f.trashedAt ? new Date(f.trashedAt).toLocaleString() : ""}>{f.trashedAt ? timeAgo(f.trashedAt) + " · " + fmtDate(f.trashedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* pagination */}
      {files && total > LIMIT && (
        <div className="row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
          <span className="small muted">Page {page} · {total} files</span>
          <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
          <Button size="sm" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}

      {detail && <FileDetail projectId={projectId} file={detail} onClose={() => setDetail(null)} onDeleted={() => { load(); onChanged && onChanged(); }} />}
    </div>
  );
}
