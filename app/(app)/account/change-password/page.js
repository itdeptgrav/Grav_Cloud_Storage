"use client";
// Focused forced-change page. The ForceChangeGate sends users here when their
// password is temporary; on success we hard-navigate to the dashboard so the
// server layout re-reads the (now false) mustChangePassword flag.
import ChangePasswordForm from "@/components/ChangePasswordForm";
import { PageHeader, Callout } from "@/components/ui";

export default function ForcedChangePasswordPage() {
  return (
    <div style={{ maxWidth: 460, margin: "0 auto" }}>
      <PageHeader title="Set a new password" subtitle="Required before you can continue" />
      <Callout type="warn" icon="alertTri" style={{ marginBottom: 16 }}>You&apos;re using a temporary password. Please set a new one to continue.</Callout>
      <div className="card">
        <ChangePasswordForm onSuccess={() => { window.location.href = "/dashboard"; }} />
      </div>
    </div>
  );
}
