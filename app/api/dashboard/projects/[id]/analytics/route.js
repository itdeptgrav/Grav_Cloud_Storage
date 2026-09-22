// GET /api/dashboard/projects/:id/analytics?days=7 — daily rollup time-series
// (from usage_daily, which survives request-log TTL). Ranges: 1 / 7 / 30 (+).
import { ok } from "@/lib/http";
import { withLog } from "@/lib/apiLog";
import { requireProject } from "@/lib/dashboardAuth";
import { projectAnalytics } from "@/lib/services/logService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLog("analytics", async (request, { params }) => {
  const { id } = await params;
  const { project, error } = await requireProject(request, id);
  if (error) return error;
  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get("days") || "7", 10) || 7));
  return ok(await projectAnalytics(project._id, days));
});
