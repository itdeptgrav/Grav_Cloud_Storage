// GET /api/config — public, minimal. Lets the UI decide what to show (signup
// link) and whether first-run setup is still needed. No secrets.
import { ok } from "@/lib/http";
import config from "@/lib/config";
import { ensureBootstrap, isSetupComplete } from "@/lib/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureBootstrap();
  let setupComplete = true;
  try {
    setupComplete = await isSetupComplete();
  } catch {
    setupComplete = false;
  }
  return ok({ allowSignup: config.allowSignup, setupComplete });
}
