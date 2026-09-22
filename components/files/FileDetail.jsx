"use client";
import { useEffect, useState } from "react";
import { fmtBytes, fmtDate, timeAgo } from "@/lib/format";
import { api } from "@/lib/clientApi";
import { Button, Badge } from "@/components/ui";

function KV({ k, v }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

function Preview({ projectId, file }) {
  const raw = `/api/dashboard/projects/${projectId}/files/${file.fileId}/raw`;
  const mime = file.mimeType || "";
  const [text, setText] = useState(null);
  const [textErr, setTextErr] = useState(false);

  useEffect(() => {
    let alive = true;
    if (mime.startsWith("text/") && file.sizeBytes <= 256 * 1024) {
      fetch(raw, { credentials: "same-origin", headers: { Range: "bytes=0-262143" } })
        .then((r) => (r.ok ? r.text() : Promise.reject()))
        .then((t) => alive && setText(t))
        .catch(() => alive && setTextErr(true));
    }
    return () => {
      alive = false;
    };
  }, [raw, mime, file.sizeBytes]);

  if (mime.startsWith("image/") && mime !== "image/svg+xml") {
    // eslint-disable-next-line @next/next/no-img-element
    return <div className="preview-box"><img src={raw} alt={file.name} /></div>;
  }
  if (mime.startsWith("video/")) {
    return <div className="preview-box"><video src={raw} controls preload="metadata" /></div>;
  }
  if (mime.startsWith("audio/")) {
    return <div className="preview-box"><audio src={raw} controls style={{ width: "100%" }} /></div>;
  }
  if (mime === "application/pdf") {
    return <div className="preview-box"><iframe src={raw} title={file.name} /></div>;
  }
  if (mime.startsWith("text/")) {
    if (textErr) return <div className="preview-box"><span className="muted small">Preview unavailable.</span></div>;
    return <div className="preview-box"><pre>{text ?? "Loading…"}</pre></div>;
  }
  return (
    <div className="preview-box">
      <div className="muted" style={{ padding: 16 }}>Preview unavailable for this file type.</div>
    </div>
  );
}

export default function FileDetail({ projectId, file, onClose, onDeleted }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const dl = `/api/dashboard/projects/${projectId}/files/${file.fileId}/download`;

  function copyId() {
    try {
      navigator.clipboard.writeText(file.fileId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  async function del() {
    if (!window.confirm(`Move "${file.name}" to Trash?`)) return;
    setBusy(true);
    try {
      await api.del(`/api/dashboard/projects/${projectId}/files/${file.fileId}`);
      onDeleted && onDeleted(file.fileId);
      onClose();
    } catch (e) {
      alert(e.message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <Preview projectId={projectId} file={file} />

        <div className="row" style={{ gap: 8, margin: "12px 0" }}>
          <a className="btn btn-sm" href={dl}>Download</a>
          <Button size="sm" onClick={copyId}>{copied ? "Copied!" : "Copy File ID"}</Button>
          <span className="spacer" />
          <Button size="sm" variant="danger" onClick={del} disabled={busy}>Delete</Button>
        </div>

        <dl className="kv">
          <KV k="File ID" v={<span className="mono">{file.fileId}</span>} />
          <KV k="Type" v={file.mimeType} />
          <KV k="Size" v={`${fmtBytes(file.sizeBytes)} (${file.sizeBytes.toLocaleString()} bytes)`} />
          <KV k="Uploaded" v={<span title={new Date(file.createdAt).toLocaleString()}>{timeAgo(file.createdAt)} · {fmtDate(file.createdAt)}</span>} />
          <KV k="Uploaded by" v={file.uploadedByLabel || "—"} />
          <KV k="SHA-256" v={<span className="mono small">{file.checksumSha256}</span>} />
          <KV k="Downloads" v={file.downloads} />
          <KV k="Bytes served" v={fmtBytes(file.bytesServed)} />
          <KV k="Status" v={<Badge kind={file.status === "active" ? "active" : undefined}>{file.status}</Badge>} />
          <KV k="Folder" v={file.folderPath?.length ? file.folderPath.join(" / ") : "—"} />
          <KV k="Tags" v={file.tags?.length ? file.tags.join(", ") : "—"} />
        </dl>
      </div>
    </>
  );
}
