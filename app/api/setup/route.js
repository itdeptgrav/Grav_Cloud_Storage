// /api/setup — first-run super-admin creation (interactive path).
//   GET  → { needed }         is setup still required?
//   POST → creates the FIRST super-admin, only if none exists yet.
// Once any super-admin exists this endpoint refuses (SETUP_ALREADY_DONE).
import { ok, fail } from "@/lib/http";
import { ensureBootstrap, isSetupComplete } from "@/lib/bootstrap";
import { countSuperadmins, createUser } from "@/lib/services/userService";
import { passwordProblem } from "@/lib/auth/password";
import { signSession, sessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureBootstrap();
  const complete = await isSetupComplete();
  return ok({ needed: !complete });
}

export async function POST(request) {
  await ensureBootstrap();
  if ((await countSuperadmins()) > 0) {
    return fail("SETUP_ALREADY_DONE", "Setup is already complete. Please sign in.");
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

  const user = await createUser({ name, email, password, role: "superadmin" });
  const token = await signSession(user);
  const res = ok({ user: user.toSafeJSON() }, { status: 201 });
  const c = sessionCookie(token);
  res.cookies.set(c.name, c.value, c.options);
  return res;
}
