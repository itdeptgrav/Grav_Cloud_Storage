"use client";

// Phase 0 landing / status page. It pings /api/health so you can confirm the
// app booted and see the live service checks. The real dashboard replaces this
// in Phase 3.

import { useEffect, useState } from "react";

const dot = (state) => ({
  display: "inline-block",
  width: 10,
  height: 10,
  borderRadius: "50%",
  marginRight: 8,
  background: state === "up" ? "var(--up)" : state === "down" ? "var(--down)" : "var(--muted)",
});

export default function Home() {
  const [health, setHealth] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setErr(e.message));
  }, []);

  const checks = health?.checks || {};

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 20px" }}>
      <h1 style={{ fontSize: 28, margin: 0 }}>
        Grav Storage <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>· Phase 0</span>
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 8 }}>
        Self-hosted object storage. This is the scaffold — auth, projects, API keys and the
        storage API arrive in later phases.
      </p>

      <section
        style={{
          marginTop: 28,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h2 style={{ fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "var(--muted)", margin: "0 0 14px" }}>
          Service Health
        </h2>

        {err && <div style={{ color: "var(--down)" }}>Could not reach /api/health: {err}</div>}

        {!err && !health && <div style={{ color: "var(--muted)" }}>Checking…</div>}

        {health && (
          <>
            <div style={{ marginBottom: 12 }}>
              Status:{" "}
              <b style={{ color: health.status === "ok" ? "var(--up)" : "var(--down)" }}>
                {String(health.status).toUpperCase()}
              </b>
            </div>
            {["api", "database", "storage"].map((k) => (
              <div key={k} style={{ padding: "4px 0", fontFamily: "ui-monospace, monospace", fontSize: 14 }}>
                <span style={dot(checks[k])} />
                {k}: <span style={{ color: checks[k] === "up" ? "var(--up)" : "var(--down)" }}>{checks[k] || "?"}</span>
              </div>
            ))}
          </>
        )}
      </section>

      <p style={{ marginTop: 20, fontSize: 13, color: "var(--muted)" }}>
        Health endpoint: <code style={{ color: "var(--accent)" }}>GET /api/health</code>
      </p>
    </main>
  );
}
