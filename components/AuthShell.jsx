"use client";
// Split auth experience: a branded hero (headline, value props, product mock)
// beside the form. Collapses to a clean single column on mobile.
import Icon from "@/components/icons";

const FEATURES = [
  ["bolt", "Streaming uploads & downloads", "900 MB+ files stream straight through — never buffered in memory."],
  ["shield", "Per-project quotas & isolation", "Scoped API keys, atomic quotas, and strict project isolation."],
  ["code", "One typed Node SDK", "Drop-in client with Range support, checksums and clear errors."],
];

const MOCK = [
  ["image", "hero-banner.webp", "4.2 MB"],
  ["fileText", "invoice-4472.pdf", "820 KB"],
  ["video", "launch-clip.mp4", "824 MB"],
  ["archive", "release-2.1.zip", "61 MB"],
];

export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="auth-split">
      <aside className="auth-hero">
        <div className="hero-brand"><span className="gs-logo">G</span> Grav Storage</div>
        <div>
          <h2 className="hero-title">Object storage built for <span className="grad">GRAV applications</span></h2>
          <p className="hero-sub">Upload, stream and serve files at any scale — with per-project quotas, scoped API keys and a typed SDK. Self-hosted, on your own disk.</p>
        </div>
        <div className="hero-feats">
          {FEATURES.map(([ic, t, d]) => (
            <div className="hf" key={t}>
              <span className="hf-ico"><Icon name={ic} size={17} /></span>
              <span><span className="hf-t">{t}</span><span className="hf-d" style={{ display: "block" }}>{d}</span></span>
            </div>
          ))}
        </div>
        <div className="hero-mock" aria-hidden="true">
          <div className="mk-bar"><span className="mk-dot" /><span className="mk-dot" /><span className="mk-dot" /><span className="mk-title">Files · Media Demo</span></div>
          {MOCK.map(([ic, nm, sz]) => (
            <div className="mk-row" key={nm}><Icon name={ic} size={15} style={{ color: "var(--muted-2)" }} /><span className="mk-nm">{nm}</span><span className="mk-sz">{sz}</span></div>
          ))}
        </div>
      </aside>

      <main className="auth-panel">
        <div className="auth-inner">
          <div className="auth-panel-brand"><span className="gs-logo">G</span> Grav Storage</div>
          <div className="card auth-card">
            <h1>{title}</h1>
            {subtitle && <p className="auth-sub">{subtitle}</p>}
            {children}
          </div>
          {footer && <div className="small muted" style={{ textAlign: "center", marginTop: 16 }}>{footer}</div>}
        </div>
      </main>
    </div>
  );
}
