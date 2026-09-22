"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { Button, Field, Input, PasswordField, ErrorNote, Loading, toast } from "@/components/ui";
import Icon from "@/components/icons";
import AuthShell from "@/components/AuthShell";

function Check({ ok, label, pending }) {
  return (
    <div className="ci">
      {pending
        ? <span className="spinner ci-ico" style={{ width: 15, height: 15 }} />
        : <Icon name={ok ? "checkCircle" : "alertCircle"} size={16} className="ci-ico" style={{ color: ok ? "var(--success)" : "var(--danger)" }} />}
      <span style={{ color: ok ? "var(--text)" : pending ? "var(--muted)" : "var(--danger)" }}>{label}</span>
    </div>
  );
}

export default function SetupPage() {
  const [ready, setReady] = useState(false);
  const [health, setHealth] = useState(null);
  const [done, setDone] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/api/setup").then((d) => { if (!d.needed) window.location.href = "/login"; else setReady(true); }).catch(() => setReady(true));
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth({ checks: {} }));
  }, []);

  async function submit(e) {
    e.preventDefault(); setErr(null);
    if (password !== confirm) { setErr("Passwords do not match."); return; }
    setBusy(true);
    try { await api.post("/api/setup", { name, email, password }); toast.success("Administrator created"); setDone(true); }
    catch (e2) { setErr(e2.message); setBusy(false); }
  }

  if (!ready) return <div className="center-narrow"><Loading /></div>;

  if (done) {
    return (
      <AuthShell title="Administrator created" subtitle="Your Grav Storage instance is ready to use">
        <div style={{ textAlign: "center", padding: "6px 0 14px" }}>
          <Icon name="checkCircle" size={40} style={{ color: "var(--success)" }} />
        </div>
        <a href="/dashboard" className="btn btn-primary btn-block">Continue to dashboard</a>
      </AuthShell>
    );
  }

  const c = health?.checks || {};
  const dbUp = c.database === "up", stUp = c.storage === "up";
  return (
    <AuthShell title="Welcome to Grav Storage" tagline="First-run setup" subtitle="Let's create the first administrator account.">
      {health && (
        <div className="setup-checklist">
          <Check ok={dbUp} pending={!health} label="MongoDB connected" />
          <Check ok={stUp} pending={!health} label="Storage directory available" />
          <Check ok={dbUp && stUp} pending={!health} label="Ready for initial setup" />
        </div>
      )}
      <form onSubmit={submit}>
        <ErrorNote>{err}</ErrorNote>
        <Field label="Name" htmlFor="name"><Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required placeholder="Grav IT Department" /></Field>
        <Field label="Email" htmlFor="email"><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="admin@example.com" /></Field>
        <Field label="Password" htmlFor="pw" hint="Use a strong password — you can change it later in Account."><PasswordField id="pw" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" placeholder="••••••••••••" /></Field>
        <Field label="Confirm password" htmlFor="pw2"><PasswordField id="pw2" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" placeholder="••••••••••••" /></Field>
        <Button variant="primary" loading={busy} className="btn-block">Create administrator</Button>
      </form>
    </AuthShell>
  );
}
