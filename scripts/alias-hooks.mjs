// scripts/alias-hooks.mjs
// Node ESM resolve hook that maps the "@/..." path alias (used throughout the
// app) to the project root, so CLI maintenance scripts can import the SAME
// service modules the server uses — no duplicated business logic.
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const base = path.join(ROOT, specifier.slice(2));
    for (const c of [base, `${base}.js`, `${base}.mjs`, path.join(base, "index.js")]) {
      if (existsSync(c)) return { url: pathToFileURL(c).href, shortCircuit: true };
    }
    return { url: pathToFileURL(`${base}.js`).href, shortCircuit: true };
  }
  return next(specifier, context);
}
