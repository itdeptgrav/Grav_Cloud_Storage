"use client";
import { useState } from "react";
import { api } from "@/lib/clientApi";
import { Button, Field, Input, ErrorNote } from "@/components/ui";

export default function ChangePasswordForm({ onSuccess }) {
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (pw !== confirm) {
      setErr("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/auth/change-password", {
        currentPassword: cur,
        newPassword: pw,
        confirmPassword: confirm,
      });
      setMsg("Password changed.");
      setCur("");
      setPw("");
      setConfirm("");
      if (onSuccess) onSuccess();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <ErrorNote>{err}</ErrorNote>
      {msg && <div className="notice notice-ok" style={{ marginBottom: 12 }}>{msg}</div>}
      <Field label="Current password">
        <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required autoComplete="current-password" />
      </Field>
      <Field label="New password">
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password">
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
      </Field>
      <Button variant="primary" disabled={busy}>{busy ? "Changing…" : "Change password"}</Button>
    </form>
  );
}
