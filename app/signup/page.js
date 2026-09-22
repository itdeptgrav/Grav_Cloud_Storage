"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { Button, Field, Input, ErrorNote, toast } from "@/components/ui";
import AuthShell from "@/components/AuthShell";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [allowSignup, setAllowSignup] = useState(null);

  useEffect(() => { api.get("/api/config").then((c) => setAllowSignup(c.allowSignup)).catch(() => setAllowSignup(false)); }, []);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.post("/api/auth/signup", { name, email, password }); toast.success("Account created"); window.location.href = "/dashboard"; }
    catch (e2) { setErr(e2.message); setBusy(false); }
  }

  if (allowSignup === false) {
    return <AuthShell title="Signup disabled" subtitle="Public registration is turned off on this server" footer={<a href="/login">Back to sign in</a>}>
      <p className="muted small" style={{ textAlign: "center", margin: 0 }}>Ask an administrator to create an account for you.</p>
    </AuthShell>;
  }

  return (
    <AuthShell title="Create account" subtitle="Start storing files in minutes" footer={<>Already have an account? <a href="/login">Sign in</a></>}>
      <form onSubmit={submit}>
        <ErrorNote>{err}</ErrorNote>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password" hint="At least 8 characters."><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <Button variant="primary" loading={busy} className="btn-block">Create account</Button>
      </form>
    </AuthShell>
  );
}
