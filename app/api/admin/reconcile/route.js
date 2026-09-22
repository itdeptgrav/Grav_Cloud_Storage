// /api/admin/reconcile — super-admin.
//   GET  → report drift across all projects (no changes)
//   POST → { projectId } explicitly repair one project's reconstructable counters
import mongoose from "mongoose";
import { ok, fail } from "@/lib/http";
import { requireAdmin } from "@/lib/auth/guards";
import { reconcileAll, applyReconcile } from "@/lib/reconcile";
import { recordAudit } from "@/lib/services/auditService";
import { ipOf } from "@/lib/apiLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  return ok({ projects: await reconcileAll() });
}

export async function POST(request) {
  const { user, error } = await requireAdmin();
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  if (!body.projectId || !mongoose.Types.ObjectId.isValid(body.projectId)) {
    return fail("VALIDATION_ERROR", "A valid projectId is required.");
  }
  const r = await applyReconcile(new mongoose.Types.ObjectId(body.projectId));
  if (!r) return fail("NOT_FOUND", "Project not found.");
  recordAudit({ user, action: "reconcile.apply", targetType: "project", targetId: body.projectId, projectId: r.projectId, details: { diff: r.diff }, ip: ipOf(request) });
  return ok(r);
}
