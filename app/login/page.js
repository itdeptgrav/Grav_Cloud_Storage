"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { Button, Field, Input, ErrorNote } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [allowSignup, setAllowSignup] = useState(false);

  useEffect(() => {
    api.get("/api/config").then((c) => setAllowSignup(c.allowSignup)).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/api/auth/login", { email, password });
      window.location.href = "/dashboard";
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  return (
    <div className="center-narrow">
      <h1>Sign in</h1>
      <p className="muted" style={{ marginTop: 0 }}>Grav Storage</p>
      <div className="card" style={{ marginTop: 18 }}>
        <form onSubmit={submit}>
          <ErrorNote>{err}</ErrorNote>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          </Field>
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button variant="primary" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
      {allowSignup && (
        <p className="small muted" style={{ textAlign: "center", marginTop: 14 }}>
          No account? <a href="/signup">Create one</a>
        </p>
      )}
      <p className="small muted" style={{ textAlign: "center", marginTop: 10 }}>
        <a href="/docs">Developer documentation →</a>
      </p>
    </div>
  );
}
