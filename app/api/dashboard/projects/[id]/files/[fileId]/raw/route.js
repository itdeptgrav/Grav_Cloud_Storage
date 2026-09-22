// GET /api/dashboard/projects/:id/files/:fileId/raw — inline preview stream
// (session cookie, Range). Concurrency-slotted; slot released when the stream
// ends/aborts (onServed) or if the object is missing.
import { fail } from "@/lib/http";
import { withLog, setLogCtx } from "@/lib/apiLog";
import { requireProject } from "@/lib/dashboardAuth";
import { loadActiveFile } from "@/lib/services/fileService";
import { serveFile } from "@/lib/fileHttp";
import { recordDownload, recordError } from "@/lib/services/usageService";
import { acquireSlot } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLog("raw", async (request, { params }) => {
  const { id, fileId } = await params;
  const { project, error } = await requireProject(request, id);
  if (error) return error;
  setLogCtx(request, { fileId });
  const file = await loadActiveFile(project, fileId);
  if (!file) return fail("FILE_NOT_FOUND", "File not found.");

  const slot = acquireSlot("download", project._id);
  if (!slot.ok) return fail("TOO_MANY_CONCURRENT_TRANSFERS", `Too many concurrent downloads for this project (max ${slot.limit}).`);

  const { response, missing } = await serveFile(file, request, {
    attachment: false,
    onServed: (n) => {
      recordDownload(project, null, file._id, n);
      slot.release();
    },
  });
  if (missing) {
    slot.release();
    console.error("[dashboard] ORPHAN: object missing:", file.fileId);
    recordError(project, null);
    return fail("FILE_NOT_FOUND", "File not found.");
  }
  return response;
});
