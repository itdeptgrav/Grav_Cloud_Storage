// /api/dashboard/projects/:id/files/:fileId  (session plane)
//   GET    → file detail (safe metadata JSON)
//   DELETE → soft-delete / trash (shared trashFile)
import { ok, fail } from "@/lib/http";
import { requireProject } from "@/lib/dashboardAuth";
import { loadActiveFile, trashFile } from "@/lib/services/fileService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id, fileId } = await params;
  const { project, error } = await requireProject(id);
  if (error) return error;
  const file = await loadActiveFile(project, fileId);
  if (!file) return fail("FILE_NOT_FOUND", "File not found.");
  return ok({ file: file.toMeta() });
}

export async function DELETE(request, { params }) {
  const { id, fileId } = await params;
  const { project, error } = await requireProject(id);
  if (error) return error;
  const file = await loadActiveFile(project, fileId);
  if (!file) return fail("FILE_NOT_FOUND", "File not found.");
  await trashFile(project, file);
  return ok({ fileId: file.fileId, status: "trashed" });
}
