"use client";
import { useState } from "react";

// Copy-to-clipboard code block used across the docs, the project Documentation
// tab and the playground. `lang` is a display label only (no highlighting dep).
export default function CodeBlock({ children, lang }) {
  const [copied, setCopied] = useState(false);
  const text = typeof children === "string" ? children : String(children ?? "");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <div className={`code ${lang ? "has-lang" : ""}`}>
      {lang && <span className="lang">{lang}</span>}
      <button className="btn btn-sm copy" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      <pre><code>{text}</code></pre>
    </div>
  );
}
