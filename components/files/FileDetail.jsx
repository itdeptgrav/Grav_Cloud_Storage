"use client";
import { useEffect, useState } from "react";
import { fmtBytes, fmtDate, timeAgo } from "@/lib/format";
import { api } from "@/lib/clientApi";
import { Button, Drawer, CopyButton, StatusBadge, confirmAction, toast } from "@/components/ui";
import Icon from "@/components/icons";

function Row({ k, v, mono }) {
  return <><dt>{k}</dt><dd className={mono ? "mono" : ""}>{v}</dd></>;
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
        .then((r) => (r.ok ? r.text() : Promise.reject())).then((t) => alive && setText(t)).catch(() => alive && setTextErr(true));
    }
    return () => { alive = false; };
  }, [raw, mime, file.sizeBytes]);

  if (mime.startsWith("image/") && mime !== "image/svg+xml") return <div className="preview-box"><img src={raw} alt={file.name} /></div>;
  if (mime.startsWith("video/")) return <div className="preview-box"><video src={raw} controls preload="metadata" /></div>;
  if (mime.startsWith("audio/")) return <div className="preview-box"><audio src={raw} controls /></div>;
  if (mime === "application/pdf") return <div className="preview-box"><iframe src={raw} title={file.name} /></div>;
  if (mime.startsWith("text/")) return <div className="preview-box">{textErr ? <span className="muted small">Preview unavailable.</span> : <pre>{text ?? "Loading…"}</pre>}</div>;
  return <div className="preview-box" style={{ padding: 28 }}><Icon name="file" size={26} style={{ color: "var(--muted-2)" }} /><div className="muted small mt-1">No preview for this file type</div></div>;
}

export default function FileDetail({ projectId, file, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const dl = `/api/dashboard/projects/${projectId}/files/${file.fileId}/download`;

  async function del() {
    const ok = await confirmAction({ title: "Move to trash?", subject: { name: file.name, meta: fmtBytes(file.sizeBytes) }, body: "The file is moved to trash and can be restored before it is purged.", confirmLabel: "Move to trash" });
    if (!ok) return;
    setBusy(true);
    try { await api.del(`/api/dashboard/projects/${projectId}/files/${file.fileId}`); toast.success("Moved to trash"); onDeleted && onDeleted(file.fileId); onClose(); }
    catch (e) { toast.error(e.message); setBusy(false); }
  }

  return (
    <Drawer title={file.name} onClose={onClose} actions={<a className="btn btn-sm btn-subtle" href={dl}><Icon name="download" size={13} />Download</a>}>
      <Preview projectId={projectId} file={file} />

      <div className="eyebrow mt-3">General</div>
      <dl className="kv">
        <Row k="Type" v={file.mimeType} />
        <Row k="Size" v={`${fmtBytes(file.sizeBytes)} · ${file.sizeBytes.toLocaleString()} bytes`} />
        <Row k="Uploaded" v={<span title={new Date(file.createdAt).toLocaleString()}>{timeAgo(file.createdAt)} · {fmtDate(file.createdAt)}</span>} />
        <Row k="Uploaded by" v={file.uploadedByLabel || "—"} />
        <Row k="Status" v={<StatusBadge status={file.status} />} />
      </dl>

      <div className="eyebrow mt-3">Developer</div>
      <dl className="kv">
        <dt>File ID</dt>
        <dd><div className="row" style={{ gap: 6 }}><span className="mono truncate" style={{ flex: 1 }}>{file.fileId}</span><CopyButton value={file.fileId} iconOnly toastMessage="File ID copied" /></div></dd>
        <dt>SHA-256</dt>
        <dd><div className="row" style={{ gap: 6 }}><span className="mono truncate small" style={{ flex: 1 }}>{file.checksumSha256}</span><CopyButton value={file.checksumSha256} iconOnly toastMessage="Checksum copied" /></div></dd>
      </dl>

      <div className="eyebrow mt-3">Usage</div>
      <dl className="kv">
        <Row k="Downloads" v={file.downloads} />
        <Row k="Bytes served" v={fmtBytes(file.bytesServed)} />
        <Row k="Folder" v={file.folderPath?.length ? file.folderPath.join(" / ") : "—"} />
        <Row k="Tags" v={file.tags?.length ? file.tags.join(", ") : "—"} />
      </dl>

      <div className="row mt-3" style={{ gap: 8 }}>
        <a className="btn btn-subtle btn-block" href={dl} style={{ flex: 1 }}><Icon name="download" size={15} />Download</a>
        <Button variant="danger" icon="trash" loading={busy} onClick={del}>Delete</Button>
      </div>
    </Drawer>
  );
}
