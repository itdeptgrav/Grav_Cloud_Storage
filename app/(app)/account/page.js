"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/clientApi";
import { fmtDate } from "@/lib/format";
import { Badge } from "@/components/ui";
import ChangePasswordForm from "@/components/ChangePasswordForm";

function Row({ label, value }) {
  return (
    <div className="between" style={{ padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function AccountPage() {
  const [me, setMe] = useState(null);

  async function load() {
    try {
      const d = await api.get("/api/auth/me");
      setMe(d.user);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    load();
  }, []);

  if (!me) return <p className="muted">Loading…</p>;

  return (
    <div style={{ maxWidth: 540 }}>
      <h1>Account</h1>
      <div className="card">
        <h2>Profile</h2>
        <Row label="Name" value={me.name} />
        <Row label="Email" value={me.email} />
        <Row label="Role" value={<Badge kind={me.role === "superadmin" ? "role" : undefined}>{me.role}</Badge>} />
        <Row label="Status" value={<Badge kind={me.status === "active" ? "active" : "revoked"}>{me.status}</Badge>} />
        <Row label="Member since" value={fmtDate(me.createdAt)} />
      </div>

      <div className="card">
        <h2>Change password</h2>
        {me.mustChangePassword && (
          <div className="notice notice-warn" style={{ marginBottom: 12 }}>
            Your password is temporary — please set a new one.
          </div>
        )}
        <ChangePasswordForm onSuccess={load} />
      </div>
    </div>
  );
}
