// POST /api/auth/login — email + password → session cookie.
// Shows the same message for unknown-email and wrong-password (no account
// enumeration).
import { ok, fail } from "@/lib/http";
import { authenticate } from "@/lib/services/userService";
import { signSession, sessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_ERROR", "Invalid JSON body.");
  }
  const { email, password } = body;
  if (!email || !password) return fail("VALIDATION_ERROR", "Email and password are required.");

  const result = await authenticate(email, password);
  if (!result.ok) {
    if (result.reason === "ACCOUNT_DISABLED") {
      return fail("ACCOUNT_DISABLED", "This account is disabled.");
    }
    return fail("INVALID_CREDENTIALS", "Incorrect email or password.");
  }

  const token = await signSession(result.user);
  const res = ok({ user: result.user.toSafeJSON() });
  const c = sessionCookie(token);
  res.cookies.set(c.name, c.value, c.options);
  return res;
}
