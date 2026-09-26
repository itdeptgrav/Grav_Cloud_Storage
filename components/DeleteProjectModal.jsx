"use client";
// Permanent project deletion — the two-step confirmation.
//   1. what will be deleted, with the project's real counts  → Continue
//   2. type the exact project name + acknowledge              → Delete permanently
// The server checks the same name and acknowledgement again
// (DELETE /api/projects/:id/permanent). A deletion that stops part-way leaves
// the project "deleting"; opening this with retry={true} goes straight to step 2.
import { useCallback, useEffect, useState } from "react";
import { api, apiFetch } from "@/lib/clientApi";
import { fmtBytes } from "@/lib/format";
import { Modal, Button, Input, Callout, ErrorNote, Skeleton } from "@/components/ui";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Counts({ counts }) {
  if (!counts) {
    return (
      <div className="del-counts">
        {[0, 1, 2].map((i) => <Skeleton key={i} w="70%" h={12} style={{ gridColumn: "1 / -1" }} />)}
      </div>
    );
  }
  const rows = [
    [plural(counts.activeFiles, "file"), fmtBytes(counts.activeBytes)],
    [plural(counts.trashedFiles, "trashed file"), fmtBytes(counts.trashedBytes)],
    [plural(counts.apiKeys, "API key"), counts.activeApiKeys ? `${counts.activeApiKeys} active` : "none active"],
  ];
  if (counts.openUploads) rows.push([plural(counts.openUploads, "unfinished upload"), fmtBytes(counts.openUploadBytes)]);
  rows.push([plural(counts.requestLogs, "request log entry", "request log entries"), `${plural(counts.usageRows, "usage record")}`]);
  return (
    <dl className="del-counts">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// After a lost response (proxy timeout, dropped connection) the deletion may
// still be running or already done: ask the server what happened.
async function settleAfterLostResponse(projectId) {
  for (let i = 0; i < 60; i++) {
    try {
      const { project } = await api.get(`/api/projects/${projectId}`);
      if (project.status === "deleting" && project.deletion?.lastErrorCode) {
        return { failed: true, stage: project.deletion.stage };
      }
    } catch (e) {
      if (e.status === 404) return { deleted: true };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { unknown: true };
}

export default function DeleteProjectModal({ project, retry = false, onClose, onDeleted }) {
  const [step, setStep] = useState(retry ? "confirm" : "warn");
  const [counts, setCounts] = useState(null);
  const [countsErr, setCountsErr] = useState(null);
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [failed, setFailed] = useState(retry);

  useEffect(() => {
    api
      .get(`/api/projects/${project.id}/permanent`)
      .then((d) => setCounts(d.counts))
      .catch((e) => setCountsErr(e.message));
  }, [project.id]);

  const matches = typed === project.name;
  const canDelete = matches && ack && !busy;
  // Stable while typing: Modal re-focuses itself whenever onClose changes.
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);

  async function doDelete() {
    if (!canDelete) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/projects/${project.id}/permanent`, { method: "DELETE", body: { confirmName: typed, acknowledge: true } });
      onDeleted(res);
      return;
    } catch (e) {
      if (e.code) {
        // The server answered: a mismatch, a failed stage (retryable), or already running.
        setErr(e.message);
        if (e.code === "PROJECT_DELETE_FAILED") setFailed(true);
        setBusy(false);
        return;
      }
      // No JSON answer (e.g. the proxy timed out) — find out what happened.
      setErr("The connection was lost. Checking whether the deletion finished…");
      const s = await settleAfterLostResponse(project.id);
      if (s.deleted) {
        onDeleted({ deleted: true, projectId: project.id, name: project.name });
        return;
      }
      if (s.failed) setFailed(true);
      setErr(s.failed ? "The deletion stopped before it finished. Retry the deletion to complete it." : "Could not confirm whether the deletion finished. Reload the page to check.");
      setBusy(false);
    }
  }

  if (step === "warn") {
    return (
      <Modal title="Delete project permanently?" onClose={close} width={520}
        footer={<>
          <Button onClick={close}>Cancel</Button>
          <Button variant="danger" onClick={() => setStep("confirm")}>Continue</Button>
        </>}>
        <div className="strong" style={{ marginBottom: 2 }}>{project.name}</div>
        <div className="mono-id" style={{ marginBottom: 12 }}>{project.id}</div>
        {countsErr ? <ErrorNote>Could not load the counts: {countsErr}</ErrorNote> : <Counts counts={counts} />}
        <p className="small" style={{ margin: "14px 0 4px" }}>This will permanently delete:</p>
        <ul className="del-list">
          <li>all active files</li>
          <li>all trashed files</li>
          <li>all upload sessions and temporary chunks</li>
          <li>all API keys</li>
          <li>all project usage data and analytics</li>
          <li>all request logs</li>
          <li>the project itself</li>
        </ul>
        <p className="faint small" style={{ margin: "0 0 12px" }}>The audit log keeps a record that the project was deleted, by whom and when.</p>
        <Callout type="danger">This action <b>cannot be undone</b>.</Callout>
      </Modal>
    );
  }

  return (
    <Modal title={`Delete "${project.name}"?`} onClose={close} width={520}
      footer={<>
        <Button onClick={close} disabled={busy}>Cancel</Button>
        <Button variant="danger-solid" icon="trash" loading={busy} disabled={!canDelete} onClick={doDelete}>
          {failed ? "Retry permanent deletion" : "Delete permanently"}
        </Button>
      </>}>
      {retry && (
        <Callout type="warn" style={{ marginBottom: 12 }}>
          A deletion of this project already started and did not finish. The project accepts nothing new; retrying completes it.
        </Callout>
      )}
      {countsErr ? <ErrorNote>Could not load the counts: {countsErr}</ErrorNote> : <Counts counts={counts} />}
      <p className="small" style={{ margin: "14px 0" }}>This action permanently deletes all project data.</p>
      <ErrorNote>{err}</ErrorNote>
      <form onSubmit={(e) => { e.preventDefault(); doDelete(); }}>
        <label className="label" htmlFor="del-confirm-name">
          Type <span className="mono del-name">{project.name}</span> to confirm
        </label>
        <Input id="del-confirm-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck={false}
          disabled={busy} className={typed && !matches ? "err" : ""} aria-invalid={typed ? !matches : undefined} />
        {typed && !matches && <div className="hint" style={{ color: "var(--danger)" }}>Does not match (the name is case-sensitive).</div>}
        <label className={`check check-danger ${ack ? "on" : ""}`} style={{ marginTop: 14 }}>
          <input type="checkbox" checked={ack} disabled={busy} onChange={(e) => setAck(e.target.checked)} />
          <span className="ck-body"><span>I understand this will permanently delete all files and project data.</span></span>
        </label>
        {busy && <p className="faint small" style={{ margin: "12px 0 0" }}>Deleting… keep this page open.</p>}
      </form>
    </Modal>
  );
}
