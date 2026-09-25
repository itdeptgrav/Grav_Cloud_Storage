// lib/bootstrap.js
// Super-admin seeding from environment.
//
// Two modes, both driven by BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD —
// there is NO hardcoded credential in the code:
//
//   1. Default (safe): if NO super-admin exists yet, create one from those env
//      values. An admin that already exists is never touched, so a restart can
//      never wipe a password you changed in the app. If the env vars are absent,
//      the /setup page lets the operator create the first admin interactively.
//
//   2. BOOTSTRAP_ADMIN_RESET=true (opt-in): make the env the source of truth —
//      ensure that admin exists as an active super-admin with the env password,
//      creating it OR resetting an existing one. Use this to (re)gain admin
//      access on a server. NOTE: while this flag is on, every restart re-applies
//      the env password, so remove it (or blank the password) after first login
//      if you don't want that.

import { connectDB } from "@/lib/db/mongoose";
import User from "@/lib/db/models/User";
import { hashPassword } from "@/lib/auth/password";

let settled = false;

export async function ensureBootstrap() {
  if (settled) return;
  await connectDB();

  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || "").toLowerCase().trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || "";
  const forceReset = /^(1|true|yes|on)$/i.test(String(process.env.BOOTSTRAP_ADMIN_RESET || ""));

  // Mode 2 — env is authoritative: create-or-reset the admin, even if one exists.
  if (email && password && forceReset) {
    const existing = await User.findOne({ email });
    if (existing) {
      existing.passwordHash = await hashPassword(password);
      existing.role = "superadmin";
      existing.status = "active";
      existing.mustChangePassword = false;
      await existing.save();
      console.log(`[bootstrap] super-admin ${email} ensured from env (BOOTSTRAP_ADMIN_RESET).`);
    } else {
      await User.create({ name: "Super Admin", email, passwordHash: await hashPassword(password), role: "superadmin", mustChangePassword: false });
      console.log(`[bootstrap] super-admin ${email} created from env (BOOTSTRAP_ADMIN_RESET).`);
    }
    settled = true;
    return;
  }

  // Mode 1 — safe default: only seed when there is no super-admin at all.
  const admins = await User.countDocuments({ role: "superadmin" });
  if (admins > 0) {
    settled = true;
    return;
  }
  if (email && password) {
    const exists = await User.findOne({ email });
    if (!exists) {
      await User.create({ name: "Super Admin", email, passwordHash: await hashPassword(password), role: "superadmin", mustChangePassword: true });
      console.log(`[bootstrap] super-admin seeded from env for ${email}.`); // never log the password
    }
    settled = true;
  }
  // else: leave incomplete; /setup handles interactive creation.
}

export async function isSetupComplete() {
  await connectDB();
  return (await User.countDocuments({ role: "superadmin" })) > 0;
}
