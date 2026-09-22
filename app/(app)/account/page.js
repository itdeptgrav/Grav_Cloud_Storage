"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { fmtDate } from "@/lib/format";
import { Badge, StatusBadge, PageHeader, Callout, Loading } from "@/components/ui";
import ChangePasswordForm from "@/components/ChangePasswordForm";

export default function AccountPage() {
  const [me, setMe] = useState(null);
  async function load() { try { setMe((await api.get("/api/auth/me")).user); } catch { /* ignore */ } }
  useEffect(() => { load(); }, []);
  if (!me) return <Loading />;

  return (
    <div style={{ maxWidth: 560 }}>
      <PageHeader title="Account" subtitle="Your profile and security settings" />
      <div className="card">
        <h2>Profile</h2>
        <dl className="kv">
          <dt>Name</dt><dd>{me.name}</dd>
          <dt>Email</dt><dd>{me.email}</dd>
          <dt>Role</dt><dd><Badge kind={me.role === "superadmin" ? "accent" : "neutral"} dot>{me.role}</Badge></dd>
          <dt>Status</dt><dd><StatusBadge status={me.status} /></dd>
          <dt>Member since</dt><dd>{fmtDate(me.createdAt)}</dd>
        </dl>
      </div>
      <div className="card">
        <h2>Change password</h2>
        {me.mustChangePassword && <Callout type="warn" icon="alertTri" style={{ marginBottom: 14 }}>Your password is temporary — please set a new one.</Callout>}
        <ChangePasswordForm onSuccess={load} />
      </div>
    </div>
  );
}
