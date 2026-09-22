// DELETE /api/dashboard/projects/:id/files/:fileId/purge — PERMANENT delete of
// a TRASHED file (destructive). Only trashed files can be purged; an active
// file must be trashed first (a normal DELETE never becomes a permanent delete).
import { ok, fail } from "@/lib/http";
import { withLog, setLogCtx, ipOf } from "@/lib/apiLog";
import { requireProject } from "@/lib/dashboardAuth";
import { loadTrashedFile, purgeFile } from "@/lib/services/fileService";
import { recordAudit } from "@/lib/services/auditService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = withLog("purge", async (request, { params }) => {
  const { id, fileId } = await params;
  const { user, project, error } = await requireProject(request, id);
  if (error) return error;
  setLogCtx(request, { fileId });
  const file = await loadTrashedFile(project, fileId);
  if (!file) return fail("FILE_NOT_FOUND", "Trashed file not found.");
  await purgeFile(file);
  recordAudit({ user, action: "file.purge", targetType: "file", targetId: file.fileId, projectId: project._id, ip: ipOf(request) });
  return ok({ fileId: file.fileId, status: "purged" });
});
