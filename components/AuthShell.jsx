"use client";
// Shared centered shell for login / signup / setup — consistent brand + card.
export default function AuthShell({ title, subtitle, tagline, children, footer }) {
  return (
    <div className="center-narrow">
      <div className="auth-brand"><span className="gs-logo">G</span> Grav Storage</div>
      {tagline && <p className="auth-tagline">{tagline}</p>}
      <div className="card auth-card">
        <h1>{title}</h1>
        {subtitle && <p className="auth-sub">{subtitle}</p>}
        {children}
      </div>
      {footer && <div className="small muted" style={{ textAlign: "center", marginTop: 16 }}>{footer}</div>}
    </div>
  );
}
