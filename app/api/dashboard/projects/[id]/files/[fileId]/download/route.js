// GET /api/dashboard/projects/:id/files/:fileId/download  (session plane)
// Attachment download for the dashboard. Same-origin cookie auth, streamed,
// safe filename — reuses serveFile (the same read/Range path as /api/v1).
import { fail } from "@/lib/http";
import { requireProject } from "@/lib/dashboardAuth";
import { loadActiveFile } from "@/lib/services/fileService";
import { serveFile } from "@/lib/fileHttp";
import { recordDownload, recordError } from "@/lib/services/usageService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id, fileId } = await params;
  const { project, error } = await requireProject(id);
  if (error) return error;
  const file = await loadActiveFile(project, fileId);
  if (!file) return fail("FILE_NOT_FOUND", "File not found.");

  const { response, missing } = await serveFile(file, request, {
    attachment: true,
    onServed: (n) => recordDownload(project, null, file._id, n),
  });
  if (missing) {
    recordError(project, null);
    return fail("FILE_NOT_FOUND", "File not found.");
  }
  return response;
}
