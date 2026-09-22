// POST /api/admin/maintenance — super-admin operational actions.
//   { action: "temp-clean" }   remove stale tmp/*.part
//   { action: "purge-trash" }  permanently purge trash past retention
// Each action is explicit and scoped (no "fix everything" button).
import { ok, fail } from "@/lib/http";
import { requireAdmin } from "@/lib/auth/guards";
import { cleanTempFiles, purgeExpiredTrash } from "@/lib/maintenance";
import { recordAudit } from "@/lib/services/auditService";
import { ipOf } from "@/lib/apiLog";
import { csrfGuard } from "@/lib/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const csrf = csrfGuard(request);
  if (csrf) return csrf;
  const { user, error } = await requireAdmin();
  if (error) return error;
  const { action } = await request.json().catch(() => ({}));

  if (action === "temp-clean") {
    const r = await cleanTempFiles();
    recordAudit({ user, action: "maintenance.temp_clean", targetType: "system", details: r, ip: ipOf(request) });
    return ok(r);
  }
  if (action === "purge-trash") {
    const r = await purgeExpiredTrash();
    recordAudit({ user, action: "maintenance.purge_trash", targetType: "system", details: r, ip: ipOf(request) });
    return ok(r);
  }
  return fail("VALIDATION_ERROR", "Unknown maintenance action.");
}
