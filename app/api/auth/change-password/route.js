// POST /api/auth/change-password
// Changes the CURRENT user's password (no target-user param exists — a user can
// only ever change their own). Reuses the single bcrypt implementation. On
// success: mustChangePassword=false, the old password stops working
// immediately (the hash is replaced), and the session cookie is reissued.
import { ok, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth/guards";
import { verifyPassword, hashPassword, passwordProblem } from "@/lib/auth/password";
import { signSession, sessionCookie } from "@/lib/auth/session";
import { csrfGuard } from "@/lib/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const csrf = csrfGuard(request);
  if (csrf) return csrf;
  const { user, error } = await requireUser();
  if (error) return error;

  let body = {};
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_ERROR", "Invalid JSON body.");
  }
  const { currentPassword, newPassword, confirmPassword } = body;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return fail("VALIDATION_ERROR", "Current, new, and confirmation passwords are all required.");
  }
  if (newPassword !== confirmPassword) {
    return fail("VALIDATION_ERROR", "New password and confirmation do not match.");
  }
  const pwErr = passwordProblem(newPassword);
  if (pwErr) return fail("VALIDATION_ERROR", pwErr);

  const currentOk = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentOk) return fail("INVALID_CREDENTIALS", "Current password is incorrect.");

  if (await verifyPassword(newPassword, user.passwordHash)) {
    return fail("VALIDATION_ERROR", "New password must be different from the current password.");
  }

  user.passwordHash = await hashPassword(newPassword); // same bcrypt cost-12 impl
  user.mustChangePassword = false;
  await user.save();

  // Reissue the current session (fresh iat/exp). The old password is already
  // dead because the stored hash changed.
  const token = await signSession(user);
  const res = ok({ user: user.toSafeJSON() });
  const c = sessionCookie(token);
  res.cookies.set(c.name, c.value, c.options);
  return res;
}
