"use client";
import { CopyButton } from "@/components/ui";

// Copy-able code block used across docs, the project Documentation tab and the
// key-created flow. `lang` is a display label only (no highlighting dep).
export default function CodeBlock({ children, lang, copy = true }) {
  const text = typeof children === "string" ? children : String(children ?? "");
  return (
    <div className={`code ${lang ? "has-lang" : ""}`}>
      {lang && <span className="lang">{lang}</span>}
      {copy && <CopyButton value={text} className="copy" iconOnly variant="subtle" />}
      <pre><code>{text}</code></pre>
    </div>
  );
}
