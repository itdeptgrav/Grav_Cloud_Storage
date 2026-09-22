"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { Button, Field, Input, PasswordField, ErrorNote, toast } from "@/components/ui";
import AuthShell from "@/components/AuthShell";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [allowSignup, setAllowSignup] = useState(false);

  useEffect(() => { api.get("/api/config").then((c) => setAllowSignup(c.allowSignup)).catch(() => {}); }, []);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.post("/api/auth/login", { email, password }); toast.success("Signed in"); window.location.href = "/dashboard"; }
    catch (e2) { setErr(e2.code === "INVALID_CREDENTIALS" ? "Incorrect email or password." : e2.message); setBusy(false); }
  }

  return (
    <AuthShell title="Sign in" tagline="Secure developer storage for GRAV applications" subtitle="Access your storage projects"
      footer={<a href="/docs">Developer documentation →</a>}>
      <form onSubmit={submit}>
        <ErrorNote>{err}</ErrorNote>
        <Field label="Email" htmlFor="email"><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required autoComplete="email" placeholder="admin@example.com" /></Field>
        <Field label="Password" htmlFor="pw"><PasswordField id="pw" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" placeholder="••••••••••••" /></Field>
        <Button variant="primary" loading={busy} className="btn-block">Sign in</Button>
      </form>
      {allowSignup && <>
        <div className="auth-divider">New to Grav Storage?</div>
        <a href="/signup" className="btn btn-subtle btn-block">Create account</a>
      </>}
    </AuthShell>
  );
}
