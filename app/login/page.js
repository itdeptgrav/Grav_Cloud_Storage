"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { Button, Field, Input, ErrorNote, toast } from "@/components/ui";
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
    catch (e2) { setErr(e2.message); setBusy(false); }
  }

  return (
    <AuthShell title="Sign in" subtitle="Access your storage projects"
      footer={<>
        {allowSignup && <div>No account? <a href="/signup">Create one</a></div>}
        <div style={{ marginTop: 8 }}><a href="/docs">Developer documentation →</a></div>
      </>}>
      <form onSubmit={submit}>
        <ErrorNote>{err}</ErrorNote>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></Field>
        <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <Button variant="primary" loading={busy} className="btn-block">Sign in</Button>
      </form>
    </AuthShell>
  );
}
