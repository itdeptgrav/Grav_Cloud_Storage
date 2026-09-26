// /api/dashboard/projects/:id/files/:fileId  (session plane)
//   GET    → file detail (safe metadata)
//   DELETE → soft-delete / trash
import { ok, fail } from "@/lib/http";
import { withLog, setLogCtx } from "@/lib/apiLog";
import { requireProject } from "@/lib/dashboardAuth";
import { loadActiveFile, trashFile } from "@/lib/services/fileService";
import { csrfGuard } from "@/lib/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLog("get-meta", async (request, { params }) => {
  const { id, fileId } = await params;
  const { project, error } = await requireProject(request, id);
  if (error) return error;
  setLogCtx(request, { fileId });
  const file = await loadActiveFile(project, fileId);
  if (!file) return fail("FILE_NOT_FOUND", "File not found.");
  return ok({ file: file.toMeta() });
});

export const DELETE = withLog("delete", async (request, { params }) => {
  const csrf = csrfGuard(request);
  if (csrf) return csrf;
  const { id, fileId } = await params;
  const { project, error } = await requireProject(request, id);
  if (error) return error;
  setLogCtx(request, { fileId });
  const file = await loadActiveFile(project, fileId);
  if (!file) return fail("FILE_NOT_FOUND", "File not found.");
  if (!(await trashFile(project, file))) return fail("PROJECT_DELETING", "This project is being permanently deleted.");
  return ok({ fileId: file.fileId, status: "trashed" });
});
