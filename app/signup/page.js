"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { Button, Field, Input, PasswordField, ErrorNote, EmptyState, toast } from "@/components/ui";
import AuthShell from "@/components/AuthShell";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [allowSignup, setAllowSignup] = useState(null);

  useEffect(() => { api.get("/api/config").then((c) => setAllowSignup(c.allowSignup)).catch(() => setAllowSignup(false)); }, []);

  async function submit(e) {
    e.preventDefault(); setErr(null);
    if (password !== confirm) { setErr("Passwords do not match."); return; }
    setBusy(true);
    try { await api.post("/api/auth/signup", { name, email, password }); toast.success("Account created"); window.location.href = "/dashboard"; }
    catch (e2) { setErr(e2.message); setBusy(false); }
  }

  if (allowSignup === false) {
    return (
      <AuthShell title="Account creation is disabled">
        <EmptyState icon="user" title="Signup is turned off">Ask your administrator to create an account, or enable signup in the server settings.</EmptyState>
        <a href="/login" className="btn btn-subtle btn-block mt-2">Back to sign in</a>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" tagline="Secure developer storage for GRAV applications" subtitle="Start storing files in minutes"
      footer={<>Already have an account? <a href="/login">Sign in</a></>}>
      <form onSubmit={submit}>
        <ErrorNote>{err}</ErrorNote>
        <Field label="Name" htmlFor="name"><Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required placeholder="Grav IT Department" /></Field>
        <Field label="Email" htmlFor="email"><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="admin@example.com" /></Field>
        <Field label="Password" htmlFor="pw" hint="At least 8 characters."><PasswordField id="pw" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" placeholder="••••••••••••" /></Field>
        <Field label="Confirm password" htmlFor="pw2"><PasswordField id="pw2" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" placeholder="••••••••••••" /></Field>
        <Button variant="primary" loading={busy} className="btn-block">Create account</Button>
      </form>
    </AuthShell>
  );
}
