// GET /api/dashboard/projects/:id/requests — the project's request log
// (project-scoped; a user can only see their own project's logs). Filters:
// from, to, apiKeyId, method, status, errors, fileId, page, limit.
import { ok } from "@/lib/http";
import { withLog } from "@/lib/apiLog";
import { requireProject } from "@/lib/dashboardAuth";
import { listRequestLogs } from "@/lib/services/logService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLog("requests", async (request, { params }) => {
  const { id } = await params;
  const { project, error } = await requireProject(request, id);
  if (error) return error;
  const url = new URL(request.url);
  return ok(await listRequestLogs(project._id, Object.fromEntries(url.searchParams.entries())));
});
