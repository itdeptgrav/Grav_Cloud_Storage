// lib/bootstrap.js
// First-run super-admin seeding.
//
// On the first request, if NO super-admin exists yet and BOOTSTRAP_ADMIN_EMAIL
// + BOOTSTRAP_ADMIN_PASSWORD are set, create the super-admin from those env
// values (password hashed, mustChangePassword=true). After that the bootstrap
// password is irrelevant to normal auth.
//
// If those env vars are absent, no admin is created here — the /setup page lets
// the operator create the first super-admin interactively. Either way there is
// NO permanent hardcoded credential.

import { connectDB } from "@/lib/db/mongoose";
import User from "@/lib/db/models/User";
import { hashPassword } from "@/lib/auth/password";

let settled = false;

export async function ensureBootstrap() {
  if (settled) return;
  await connectDB();
  const admins = await User.countDocuments({ role: "superadmin" });
  if (admins > 0) {
    settled = true;
    return;
  }
  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || "").toLowerCase().trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || "";
  if (email && password) {
    const exists = await User.findOne({ email });
    if (!exists) {
      await User.create({
        name: "Super Admin",
        email,
        passwordHash: await hashPassword(password),
        role: "superadmin",
        mustChangePassword: true,
      });
      // NOTE: never log the password.
      console.log(`[bootstrap] super-admin seeded from env for ${email}.`);
    }
    settled = true;
  }
  // else: leave incomplete; /setup handles interactive creation.
}

export async function isSetupComplete() {
  await connectDB();
  return (await User.countDocuments({ role: "superadmin" })) > 0;
}
