"use client";
// Shared centered shell for login / signup / setup — consistent brand + card.
export default function AuthShell({ title, subtitle, children, footer, wide }) {
  return (
    <div className="center-narrow" style={wide ? { maxWidth: 460 } : undefined}>
      <div className="auth-brand"><span className="gs-logo">G</span> Grav Storage</div>
      <div className="card auth-card">
        <h1>{title}</h1>
        {subtitle && <p className="auth-sub">{subtitle}</p>}
        {children}
      </div>
      {footer && <div className="small muted" style={{ textAlign: "center", marginTop: 16 }}>{footer}</div>}
    </div>
  );
}
