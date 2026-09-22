// lib/services/userService.js
import { connectDB } from "@/lib/db/mongoose";
import User from "@/lib/db/models/User";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

const normEmail = (e) => String(e || "").toLowerCase().trim();

export async function countSuperadmins() {
  await connectDB();
  return User.countDocuments({ role: "superadmin" });
}

export async function findByEmail(email) {
  await connectDB();
  return User.findOne({ email: normEmail(email) });
}

export async function createUser({ name, email, password, role = "user", mustChangePassword = false }) {
  await connectDB();
  const passwordHash = await hashPassword(password);
  return User.create({ name: String(name).trim(), email: normEmail(email), passwordHash, role, mustChangePassword });
}

/**
 * Verify credentials. Returns { ok:true, user } or { ok:false, reason }.
 * The reason distinguishes disabled accounts from bad credentials for the
 * server, but the login route deliberately shows the same message for both
 * "no such email" and "wrong password" (no account enumeration).
 */
export async function authenticate(email, password) {
  await connectDB();
  const user = await User.findOne({ email: normEmail(email) });
  if (!user) return { ok: false, reason: "INVALID_CREDENTIALS" };
  if (user.status !== "active") return { ok: false, reason: "ACCOUNT_DISABLED" };
  const good = await verifyPassword(password, user.passwordHash);
  if (!good) return { ok: false, reason: "INVALID_CREDENTIALS" };
  user.lastLoginAt = new Date();
  await user.save();
  return { ok: true, user };
}
