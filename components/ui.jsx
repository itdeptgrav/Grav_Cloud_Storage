"use client";
// Grav Storage shared UI library. One consistent system for every page.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Icon from "@/components/icons";

/* ─────────────────────────── clipboard ─────────────────────────── */
export async function copyText(value) {
  const text = String(value ?? "");
  try {
    if (navigator.clipboard && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/* ─────────────────────────── toast store ─────────────────────────── */
let toasts = [];
const toastSubs = new Set();
let toastId = 0;
function emitToasts() { toastSubs.forEach((f) => f()); }
function pushToast(type, message, ttl) {
  const id = ++toastId;
  toasts = [...toasts, { id, type, message }];
  emitToasts();
  setTimeout(() => dismissToast(id), ttl ?? (type === "error" ? 4200 : 2600));
  return id;
}
function dismissToast(id) { toasts = toasts.filter((t) => t.id !== id); emitToasts(); }
export const toast = {
  success: (m, ttl) => pushToast("ok", m, ttl),
  error: (m, ttl) => pushToast("error", m, ttl),
  warn: (m, ttl) => pushToast("warn", m, ttl),
  info: (m, ttl) => pushToast("info", m, ttl),
};

export function Toaster() {
  const list = useSyncExternalStore(
    (cb) => { toastSubs.add(cb); return () => toastSubs.delete(cb); },
    () => toasts,
    () => toasts,
  );
  const ico = { ok: "checkCircle", error: "alertCircle", warn: "alertTri", info: "info" };
  return (
    <div className="toaster" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <Icon name={ico[t.type] || "info"} size={17} className="t-ico" />
          <span className="t-msg">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── confirm store ─────────────────────────── */
let confirmState = null;
const confirmSubs = new Set();
function emitConfirm() { confirmSubs.forEach((f) => f()); }
export function confirmAction(opts) {
  return new Promise((resolve) => {
    confirmState = { ...opts, resolve };
    emitConfirm();
  });
}
export function ConfirmHost() {
  const state = useSyncExternalStore(
    (cb) => { confirmSubs.add(cb); return () => confirmSubs.delete(cb); },
    () => confirmState,
    () => confirmState,
  );
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const close = (v) => { const r = state.resolve; confirmState = null; emitConfirm(); setBusy(false); r(v); };
  async function onConfirm() {
    if (state.onConfirm) { setBusy(true); try { await state.onConfirm(); } catch { /* caller handles */ } }
    close(true);
  }
  return (
    <Modal title={state.title || "Are you sure?"} onClose={() => close(false)} width={440}
      footer={
        <>
          <Button onClick={() => close(false)} disabled={busy}>{state.cancelLabel || "Cancel"}</Button>
          <Button variant={state.danger ? "danger-solid" : "primary"} loading={busy} onClick={onConfirm}>
            {state.confirmLabel || "Confirm"}
          </Button>
        </>
      }
    >
      {state.subject && (
        <div className="row" style={{ gap: 10, marginBottom: 12 }}>
          {state.subject.icon && <span className="ftype" style={{ height: 26, minWidth: 44 }}>{state.subject.icon}</span>}
          <div>
            <div className="strong">{state.subject.name}</div>
            {state.subject.meta && <div className="muted small">{state.subject.meta}</div>}
          </div>
        </div>
      )}
      {typeof state.body === "string" ? <p className="muted" style={{ margin: 0 }}>{state.body}</p> : state.body}
    </Modal>
  );
}

/* ─────────────────────────── Button ─────────────────────────── */
export function Button({ variant = "", size = "", className = "", loading = false, icon, children, disabled, ...props }) {
  const v = variant ? `btn-${variant}` : "";
  const s = size ? `btn-${size}` : "";
  return (
    <button className={`btn ${v} ${s} ${className}`} disabled={disabled || loading} {...props}>
      {loading ? <span className="spinner" style={{ width: 13, height: 13 }} /> : icon ? <Icon name={icon} size={size === "sm" ? 13 : 15} /> : null}
      {children}
    </button>
  );
}
export function IconButton({ name, size = "sm", variant = "ghost", label, className = "", ...props }) {
  return (
    <button className={`btn btn-icon btn-${variant} ${size ? `btn-${size}` : ""} ${className}`} aria-label={label} title={label} {...props}>
      <Icon name={name} size={size === "sm" ? 15 : 16} />
    </button>
  );
}

/* ─────────────────────────── Copy ─────────────────────────── */
export function CopyButton({ value, label = "Copy", size = "sm", variant = "subtle", iconOnly = false, className = "", toastMessage = "Copied to clipboard", onCopied }) {
  const [copied, setCopied] = useState(false);
  async function onClick(e) {
    e.stopPropagation?.();
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      toast.success(toastMessage);
      onCopied && onCopied();
      setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error("Could not copy");
    }
  }
  return (
    <button className={`btn btn-${size} ${copied ? "btn-copied" : `btn-${variant}`} ${className}`} onClick={onClick}
      aria-label={copied ? "Copied" : label} title={label}>
      <Icon name={copied ? "check" : "copy"} size={size === "sm" ? 13 : 14} />
      {!iconOnly && (copied ? "Copied" : label)}
    </button>
  );
}
// legacy alias used by older pages
export function Copyable({ value, label = "Copy" }) { return <CopyButton value={value} label={label} />; }

/* ─────────────────────────── Form ─────────────────────────── */
export function Field({ label, hint, required, children, htmlFor }) {
  return (
    <div className="field">
      {label && <label className="label" htmlFor={htmlFor}>{label}{required && <span className="req">*</span>}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
export function Input({ className = "", ...props }) { return <input className={`input ${className}`} {...props} />; }
export function PasswordField({ className = "", ...props }) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw-field">
      <input className={`input ${className}`} type={show ? "text" : "password"} {...props} />
      <button type="button" className="pw-toggle" tabIndex={-1} aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((s) => !s)}>
        <Icon name={show ? "eyeOff" : "eye"} size={15} />
      </button>
    </span>
  );
}
export function Textarea({ className = "", ...props }) { return <textarea className={`input ${className}`} {...props} />; }
export function Select({ className = "", children, ...props }) { return <select className={`select ${className}`} {...props}>{children}</select>; }
export function SearchInput({ className = "", ...props }) {
  return (
    <span className="input-wrap" style={{ flex: props.flex ? 1 : undefined }}>
      <Icon name="search" className="lead" />
      <input className={`input input-sm ${className}`} {...props} />
    </span>
  );
}

/* ─────────────────────────── Badge ─────────────────────────── */
export function Badge({ children, kind, dot }) {
  return <span className={`badge ${kind ? `badge-${kind}` : ""}`}>{dot && <span className="dot" />}{children}</span>;
}
export function StatusBadge({ status }) {
  const map = { active: "active", disabled: "warn", archived: "neutral", revoked: "revoked", trashed: "neutral" };
  return <Badge kind={map[status] || "neutral"} dot={status === "active"}>{status}</Badge>;
}

/* ─────────────────────────── Notices ─────────────────────────── */
export function ErrorNote({ children }) {
  if (!children) return null;
  return <div className="notice notice-error" style={{ marginBottom: 12 }}><Icon name="alertCircle" size={16} />{children}</div>;
}
export function Callout({ type = "info", icon, children, style }) {
  const def = { warn: "alertTri", danger: "alertTri", ok: "checkCircle", info: "info" }[type];
  return <div className={`notice notice-${type === "danger" ? "error" : type === "ok" ? "ok" : type}`} style={style}><Icon name={icon || def} size={16} /><div>{children}</div></div>;
}

/* ─────────────────────────── Modal ─────────────────────────── */
export function Modal({ title, onClose, children, width, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}
        style={width ? { maxWidth: width } : undefined} onMouseDown={(e) => e.stopPropagation()}>
        {title && (
          <div className="modal-head">
            <h2>{title}</h2>
            <IconButton name="x" label="Close" onClick={onClose} />
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ─────────────────────────── Drawer ─────────────────────────── */
export function Drawer({ title, onClose, children, actions }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <div className="truncate strong" style={{ fontSize: 14 }}>{title}</div>
          <div className="row" style={{ gap: 6 }}>{actions}<IconButton name="x" label="Close" onClick={onClose} /></div>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </>
  );
}

/* ─────────────────────────── Dropdown menu ─────────────────────────── */
export function Dropdown({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onDoc = () => onClose?.();
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="menu" onClick={(e) => e.stopPropagation()}>{children}</div>;
}
export function MenuItem({ icon, danger, children, ...props }) {
  return <button className={danger ? "danger" : ""} {...props}>{icon && <Icon name={icon} size={14} />}{children}</button>;
}

/* ─────────────────────────── Page / section headers ─────────────────────────── */
export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {back && <a href={back.href} className="row small muted" style={{ gap: 5, marginBottom: 8, width: "fit-content" }}><Icon name="arrowLeft" size={13} />{back.label}</a>}
        <h1 className="ph-title">{title}</h1>
        {subtitle && <p className="ph-sub">{subtitle}</p>}
      </div>
      {actions && <div className="row" style={{ gap: 8, flex: "none" }}>{actions}</div>}
    </div>
  );
}
export function SectionHeader({ title, actions }) {
  return <div className="section-head"><h2>{title}</h2>{actions && <div className="row" style={{ gap: 8 }}>{actions}</div>}</div>;
}

/* ─────────────────────────── Stat ─────────────────────────── */
export function StatCard({ label, value, sub, icon }) {
  return (
    <div className="stat">
      <div className="between"><span className="lbl">{label}</span>{icon && <Icon name={icon} size={15} style={{ color: "var(--muted-2)" }} />}</div>
      <div className="val">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

/* ─────────────────────────── Skeleton / states ─────────────────────────── */
export function Skeleton({ w = "100%", h = 12, style }) { return <div className="skel" style={{ width: w, height: h, ...style }} />; }
export function TableSkeleton({ rows = 6, cols = 4 }) {
  return (
    <div className="card card-pad-0" style={{ padding: 14 }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="row" style={{ gap: 16, padding: "9px 0", borderBottom: r < rows - 1 ? "1px solid var(--border)" : "0" }}>
          {Array.from({ length: cols }).map((_, c) => <Skeleton key={c} w={c === 0 ? "34%" : `${18 - c * 2}%`} />)}
        </div>
      ))}
    </div>
  );
}
export function EmptyState({ icon = "folder", title, children, action }) {
  return (
    <div className="empty">
      <div className="ico"><Icon name={icon} size={20} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function Spinner({ lg }) { return <span className={`spinner ${lg ? "spinner-lg" : ""}`} />; }
export function Loading({ label = "Loading…" }) {
  return <div className="state"><Spinner /> <span style={{ marginLeft: 8 }}>{label}</span></div>;
}

/* ─────────────────────────── Tabs ─────────────────────────── */
export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={value === id} className={`tab ${value === id ? "tab-active" : ""}`} onClick={() => onChange(id)}>{label}</button>
      ))}
    </div>
  );
}
