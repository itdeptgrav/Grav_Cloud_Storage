// lib/auth/password.js
// Password hashing with bcryptjs (pure JS — no native build on Windows).
// Cost 12 is a sensible interactive-login default.

import bcrypt from "bcryptjs";

const COST = 12;
export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(plain) {
  return bcrypt.hash(String(plain), COST);
}

export async function verifyPassword(plain, hash) {
  try {
    return await bcrypt.compare(String(plain), String(hash || ""));
  } catch {
    return false;
  }
}

/** Returns null if OK, or a human message describing why the password is weak. */
export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
