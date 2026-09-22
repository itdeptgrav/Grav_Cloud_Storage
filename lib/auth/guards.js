// lib/auth/guards.js
// Route-handler guards for the DASHBOARD (session) API. Each returns either
// { user } (a live User doc) or { error } (a ready-to-return Response). Auth is
// re-checked against the database every request — a disabled account cannot ride
// an old cookie.

import { readSession } from "@/lib/auth/session";
import { fail } from "@/lib/http";
import { connectDB } from "@/lib/db/mongoose";
import User from "@/lib/db/models/User";

export async function requireUser() {
  const session = await readSession();
  if (!session) return { error: fail("UNAUTHENTICATED", "You must be signed in.") };
  await connectDB();
  const user = await User.findById(session.id);
  if (!user) return { error: fail("UNAUTHENTICATED", "Your session is no longer valid.") };
  if (user.status !== "active") return { error: fail("ACCOUNT_DISABLED", "This account is disabled.") };
  return { user };
}

export async function requireAdmin() {
  const res = await requireUser();
  if (res.error) return res;
  if (res.user.role !== "superadmin") {
    return { error: fail("FORBIDDEN", "Administrator access required.") };
  }
  return res;
}
