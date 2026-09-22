"use client";
// Small shared UI primitives for the dashboard. Deliberately minimal.

export function Button({ variant = "", size = "", className = "", ...props }) {
  const v = variant ? `btn-${variant}` : "";
  const s = size ? `btn-${size}` : "";
  return <button className={`btn ${v} ${s} ${className}`} {...props} />;
}

export function Field({ label, children }) {
  return (
    <div className="field">
      {label && <label className="label">{label}</label>}
      {children}
    </div>
  );
}

export function Input(props) {
  return <input className="input" {...props} />;
}

export function Badge({ children, kind }) {
  return <span className={`badge ${kind ? `badge-${kind}` : ""}`}>{children}</span>;
}

export function Modal({ title, onClose, children, width }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={width ? { maxWidth: width } : undefined} onMouseDown={(e) => e.stopPropagation()}>
        {title && (
          <div className="between" style={{ marginBottom: 14 }}>
            <h2 style={{ margin: 0 }}>{title}</h2>
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return <div className="notice notice-error" style={{ marginBottom: 12 }}>{children}</div>;
}

export function Copyable({ value }) {
  return (
    <button
      className="btn btn-sm"
      onClick={() => {
        try {
          navigator.clipboard.writeText(value);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      Copy
    </button>
  );
}
