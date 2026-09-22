// POST /api/auth/signup — public self-service registration (developer flow).
// Gated by ALLOW_SIGNUP. Creates a normal "user" and signs them in.
import { ok, fail } from "@/lib/http";
import config from "@/lib/config";
import { findByEmail, createUser } from "@/lib/services/userService";
import { passwordProblem } from "@/lib/auth/password";
import { signSession, sessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!config.allowSignup) {
    return fail("SIGNUP_DISABLED", "Public signup is disabled on this server.");
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_ERROR", "Invalid JSON body.");
  }
  const { name, email, password } = body;
  if (!name || !email) return fail("VALIDATION_ERROR", "Name and email are required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) return fail("VALIDATION_ERROR", "Enter a valid email.");
  const pwErr = passwordProblem(password);
  if (pwErr) return fail("VALIDATION_ERROR", pwErr);

  if (await findByEmail(email)) {
    return fail("EMAIL_TAKEN", "An account with this email already exists.");
  }

  const user = await createUser({ name, email, password, role: "user" });
  const token = await signSession(user);
  const res = ok({ user: user.toSafeJSON() }, { status: 201 });
  const c = sessionCookie(token);
  res.cookies.set(c.name, c.value, c.options);
  return res;
}
