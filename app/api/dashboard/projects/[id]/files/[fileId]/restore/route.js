// POST /api/dashboard/projects/:id/files/:fileId/restore — trashed → active.
// Quota-checked and all-or-nothing (see fileService.restoreFile).
import { ok, fail } from "@/lib/http";
import { withLog, setLogCtx, ipOf } from "@/lib/apiLog";
import { requireProject } from "@/lib/dashboardAuth";
import { loadTrashedFile, restoreFile } from "@/lib/services/fileService";
import { recordAudit } from "@/lib/services/auditService";
import { csrfGuard } from "@/lib/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withLog("restore", async (request, { params }) => {
  const csrf = csrfGuard(request);
  if (csrf) return csrf;
  const { id, fileId } = await params;
  const { user, project, error } = await requireProject(request, id);
  if (error) return error;
  setLogCtx(request, { fileId });
  const file = await loadTrashedFile(project, fileId);
  if (!file) return fail("FILE_NOT_FOUND", "Trashed file not found.");
  const r = await restoreFile(project, file);
  if (!r.ok) return fail(r.code, r.message);
  recordAudit({ user, action: "file.restore", targetType: "file", targetId: file.fileId, projectId: project._id, ip: ipOf(request) });
  return ok({ fileId: file.fileId, status: "active" });
});
