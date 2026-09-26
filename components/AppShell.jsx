"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/clientApi";
import { toast, IconButton } from "@/components/ui";
import Icon from "@/components/icons";

function NavLink({ href, icon, label, active, onNav }) {
  return (
    <a href={href} className={`nav-link ${active ? "on" : ""}`} onClick={onNav}>
      {icon && <Icon name={icon} size={16} />}
      <span className="truncate">{label}</span>
    </a>
  );
}

export default function AppShell({ user, children }) {
  const pathname = usePathname() || "";
  const [projects, setProjects] = useState([]);
  const [open, setOpen] = useState(false); // mobile drawer
  const isAdmin = user.role === "superadmin";

  useEffect(() => {
    api.get("/api/projects").then((d) => setProjects(d.projects || [])).catch(() => {});
  }, []);
  // A permanently deleted project leaves the sidebar immediately (no reload).
  useEffect(() => {
    const onRemoved = (e) => setProjects((list) => list.filter((p) => p.id !== e.detail?.id));
    window.addEventListener("gs:project-removed", onRemoved);
    return () => window.removeEventListener("gs:project-removed", onRemoved);
  }, []);
  useEffect(() => { setOpen(false); }, [pathname]);

  async function logout() {
    try { await api.post("/api/auth/logout"); } catch { /* ignore */ }
    toast.info("Signed out");
    window.location.href = "/login";
  }

  const is = (h) => pathname === h;
  const initials = (user.name || user.email || "?").trim().slice(0, 1).toUpperCase();

  const nav = (
    <>
      <a href="/dashboard" className="brand"><span className="logo">G</span> Grav Storage</a>

      <NavLink href="/dashboard" icon="dashboard" label="Dashboard" active={is("/dashboard")} />

      {projects.length > 0 && (
        <div className="nav-group">
          <div className="ng-label">Projects</div>
          {projects.slice(0, 6).map((p) => (
            <NavLink key={p.id} href={`/projects/${p.id}`} icon="folder" label={p.name} active={pathname.startsWith(`/projects/${p.id}`)} />
          ))}
        </div>
      )}

      <div className="nav-group">
        <div className="ng-label">Developer</div>
        <NavLink href="/docs" icon="book" label="Documentation" active={is("/docs")} />
        <NavLink href="/playground" icon="code" label="Playground" active={is("/playground")} />
      </div>

      {isAdmin && (
        <div className="nav-group">
          <div className="ng-label">Admin</div>
          <NavLink href="/admin/logs" icon="logs" label="Request Logs" active={is("/admin/logs")} />
          <NavLink href="/admin/integrity" icon="shield" label="Integrity" active={is("/admin/integrity")} />
          <NavLink href="/admin/maintenance" icon="wrench" label="Maintenance" active={is("/admin/maintenance")} />
          <NavLink href="/admin/benchmark" icon="gauge" label="Benchmark" active={is("/admin/benchmark")} />
        </div>
      )}

      <div className="sb-foot">
        <a href="/account" className="user-chip nav-link" style={{ padding: "7px 8px" }}>
          <span className="avatar">{initials}</span>
          <span style={{ minWidth: 0 }}>
            <span className="truncate" style={{ display: "block", fontSize: 12.5, color: "var(--text)" }}>{user.email}</span>
            <span className="truncate small faint" style={{ display: "block", textTransform: "capitalize" }}>{user.role}</span>
          </span>
        </a>
        <button className="nav-link" style={{ width: "100%", background: "none", border: 0, cursor: "pointer", marginTop: 2 }} onClick={logout}>
          <Icon name="logout" size={16} /> Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="shell">
      <div className={`sidebar-backdrop ${open ? "open" : ""}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? "open" : ""}`}>{nav}</aside>
      <div className="main">
        <div className="mobile-top">
          <IconButton name="menu" label="Menu" variant="subtle" onClick={() => setOpen(true)} />
          <a href="/dashboard" className="brand" style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="logo">G</span> Grav Storage</a>
        </div>
        <div className="main-inner">{children}</div>
      </div>
    </div>
  );
}
