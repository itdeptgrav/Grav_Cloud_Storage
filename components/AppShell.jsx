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
          <a href="/playground" className="btn btn-ghost btn-sm">Playground</a>
          <a href="/docs" className="btn btn-ghost btn-sm">Docs</a>
          <span className="spacer" />
          {user.role === "superadmin" && (
            <>
              <a href="/admin/benchmark" className="btn btn-ghost btn-sm">Benchmark</a>
              <a href="/admin/maintenance" className="btn btn-ghost btn-sm">Maintenance</a>
              <a href="/admin/logs" className="btn btn-ghost btn-sm">Logs</a>
            </>
          )}
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
