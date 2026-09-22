"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { Button, Field, Input, ErrorNote, Loading, toast } from "@/components/ui";
import AuthShell from "@/components/AuthShell";

export default function SetupPage() {
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/api/setup").then((d) => { if (!d.needed) window.location.href = "/login"; else setReady(true); }).catch(() => setReady(true));
  }, []);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.post("/api/setup", { name, email, password }); toast.success("Super-admin created"); window.location.href = "/dashboard"; }
    catch (e2) { setErr(e2.message); setBusy(false); }
  }

  if (!ready) return <div className="center-narrow"><Loading /></div>;

  return (
    <AuthShell title="First-time setup" subtitle="Create the Grav Storage super-admin account">
      <form onSubmit={submit}>
        <ErrorNote>{err}</ErrorNote>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password" hint="Use a strong password — you can change it later in Account."><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <Button variant="primary" loading={busy} className="btn-block">Create super-admin</Button>
      </form>
    </AuthShell>
  );
}
