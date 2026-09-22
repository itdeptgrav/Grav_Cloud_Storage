// lib/config.js
// Central configuration for Grav Storage, read from the environment.
// Next.js auto-loads .env / .env.local. Nothing here is exposed to the browser
// unless it is prefixed NEXT_PUBLIC_ — and API secrets are deliberately never
// prefixed that way.

function bool(v, dflt) {
  if (v == null || v === "") return dflt;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

export const config = {
  port: Number(process.env.PORT || 4000),

  // A SEPARATE local database. Never the CMS/Atlas connection.
  mongoUri: process.env.MONGODB_URI || "mongodb://localhost:27017/grav_storage",

  // Where actual file bytes live — OUTSIDE this repo. Object files go under
  // this directory; tmp/ and trash/ are created as siblings (see localProvider).
  storageRoot: process.env.STORAGE_ROOT || "D:\\GravStorage\\data",
  storageProvider: (process.env.STORAGE_PROVIDER || "local").toLowerCase(),

  // Cloudinary-style public signup toggle.
  allowSignup: bool(process.env.ALLOW_SIGNUP, true),

  logRetentionDays: Number(process.env.LOG_RETENTION_DAYS || 30),

  // Used from Phase 1 onward (sessions + key hashing). Warned about, not
  // enforced, in Phase 0 because no auth exists yet.
  jwtSecret: process.env.JWT_SECRET || "",
  keyHashPepper: process.env.KEY_HASH_PEPPER || "",

  isProd: process.env.NODE_ENV === "production",
};

/** Non-fatal startup validation. Logs once; never throws in Phase 0. */
export function validateConfig() {
  const warnings = [];
  if (config.isProd && !config.jwtSecret) {
    warnings.push("JWT_SECRET is not set — required before Phase 1 auth ships.");
  }
  return warnings;
}

export default config;
