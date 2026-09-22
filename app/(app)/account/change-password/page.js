"use client";
// Focused forced-change page. The ForceChangeGate sends users here when their
// password is temporary; on success we hard-navigate to the dashboard so the
// server layout re-reads the (now false) mustChangePassword flag.
import ChangePasswordForm from "@/components/ChangePasswordForm";

export default function ForcedChangePasswordPage() {
  return (
    <div style={{ maxWidth: 460, margin: "0 auto" }}>
      <h1>Set a new password</h1>
      <div className="notice notice-warn" style={{ margin: "10px 0 16px" }}>
        You&apos;re using a temporary password. Please set a new one to continue.
      </div>
      <div className="card">
        <ChangePasswordForm
          onSuccess={() => {
            window.location.href = "/dashboard";
          }}
        />
      </div>
    </div>
  );
}
