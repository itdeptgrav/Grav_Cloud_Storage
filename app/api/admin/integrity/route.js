// GET /api/admin/integrity?full=1 — super-admin integrity scan (report-only).
import { ok } from "@/lib/http";
import { requireAdmin } from "@/lib/auth/guards";
import { runIntegrityCheck } from "@/lib/integrity";
import { recordAudit } from "@/lib/services/auditService";
import { ipOf } from "@/lib/apiLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const { user, error } = await requireAdmin();
  if (error) return error;
  const full = new URL(request.url).searchParams.get("full") === "1";
  recordAudit({ user, action: full ? "integrity.full" : "integrity.quick", targetType: "system", ip: ipOf(request) });
  return ok(await runIntegrityCheck({ full }));
}
