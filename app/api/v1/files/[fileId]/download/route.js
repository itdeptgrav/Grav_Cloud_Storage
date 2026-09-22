// GET /api/v1/files/:fileId/download — attachment download (files:read), Range.
import { fail } from "@/lib/http";
import { withLog, setLogCtx } from "@/lib/apiLog";
import { authenticateApiKey } from "@/lib/apiKeyAuth";
import { loadActiveFile } from "@/lib/services/fileService";
import { serveFile } from "@/lib/fileHttp";
import { recordDownload, recordError } from "@/lib/services/usageService";
import { acquireSlot } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLog("download", async (request, { params }) => {
  const auth = await authenticateApiKey(request, "files:read");
  if (auth.error) return auth.error;
  const { key, project } = auth;
  const { fileId } = await params;
  setLogCtx(request, { fileId });
  const file = await loadActiveFile(project, fileId);
  if (!file) return fail("FILE_NOT_FOUND", "File not found.");

  const slot = acquireSlot("download", project._id);
  if (!slot.ok) return fail("TOO_MANY_CONCURRENT_TRANSFERS", `Too many concurrent downloads for this project (max ${slot.limit}).`);
  const { response, missing } = await serveFile(file, request, {
    attachment: true,
    onServed: (n) => { recordDownload(project, key, file._id, n); slot.release(); },
  });
  if (missing) {
    slot.release();
    recordError(project, key);
    return fail("FILE_NOT_FOUND", "File not found.");
  }
  return response;
});
