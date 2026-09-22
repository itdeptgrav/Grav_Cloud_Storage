"use client";
import { api } from "@/lib/clientApi";

export default function AppShell({ user, children }) {
  async function logout() {
    try {
      await api.post("/api/auth/logout");
    } catch {
      /* ignore */
    }
    window.location.href = "/login";
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <a href="/dashboard" className="brand" style={{ color: "var(--text)", textDecoration: "none" }}>
            Grav Storage
          </a>
          <span className="spacer" />
          <span className="small muted">{user.email}</span>
          <span className={`badge ${user.role === "superadmin" ? "badge-role" : ""}`}>{user.role}</span>
          <a href="/account" className="btn btn-ghost btn-sm">Account</a>
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            Logout
          </button>
        </div>
      </div>
      <div className="container">{children}</div>
    </>
  );
}
