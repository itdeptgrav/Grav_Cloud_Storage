// GET /api/dashboard/projects/:id/files/:fileId/raw  (session plane)
// Streams bytes for inline preview (<img>/<video>/<iframe>/<audio>). Same-origin
// so the httpOnly session cookie is sent automatically — NO API key in the
// browser. Reuses serveFile (Range/206/416) — the SAME read path as /api/v1.
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
    attachment: false,
    onServed: (n) => recordDownload(project, null, file._id, n),
  });
  if (missing) {
    console.error("[dashboard] ORPHAN: metadata exists but object missing:", file.fileId);
    recordError(project, null);
    return fail("FILE_NOT_FOUND", "File not found.");
  }
  return response;
}
