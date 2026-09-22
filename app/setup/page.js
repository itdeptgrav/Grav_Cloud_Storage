"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { Button, Field, Input, ErrorNote } from "@/components/ui";

export default function SetupPage() {
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get("/api/setup")
      .then((d) => {
        if (!d.needed) {
          window.location.href = "/login"; // already set up
        } else {
          setReady(true);
        }
      })
      .catch(() => setReady(true));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/api/setup", { name, email, password });
      window.location.href = "/dashboard";
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  if (!ready) return <div className="center-narrow"><p className="muted">Loading…</p></div>;

  return (
    <div className="center-narrow">
      <h1>First-time setup</h1>
      <p className="muted" style={{ marginTop: 0 }}>Create the Grav Storage super-admin.</p>
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
            {busy ? "Creating…" : "Create super-admin"}
          </Button>
        </form>
      </div>
    </div>
  );
}
