"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { Button, Field, Input, ErrorNote } from "@/components/ui";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [allowSignup, setAllowSignup] = useState(null);

  useEffect(() => {
    api.get("/api/config").then((c) => setAllowSignup(c.allowSignup)).catch(() => setAllowSignup(false));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/api/auth/signup", { name, email, password });
      window.location.href = "/dashboard";
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  if (allowSignup === false) {
    return (
      <div className="center-narrow">
        <h1>Signup disabled</h1>
        <p className="muted">Public registration is turned off on this server. Ask an administrator for an account.</p>
        <p className="small"><a href="/login">Back to sign in</a></p>
      </div>
    );
  }

  return (
    <div className="center-narrow">
      <h1>Create account</h1>
      <p className="muted" style={{ marginTop: 0 }}>Grav Storage</p>
      <div className="card" style={{ marginTop: 18 }}>
        <form onSubmit={submit}>
          <ErrorNote>{err}</ErrorNote>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button variant="primary" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Creating…" : "Create account"}
          </Button>
        </form>
      </div>
      <p className="small muted" style={{ textAlign: "center", marginTop: 14 }}>
        Already have an account? <a href="/login">Sign in</a>
      </p>
    </div>
  );
}
