// GET /api/v1/files/:fileId/download — same bytes as GET, but always
// Content-Disposition: attachment (scope files:read). Range supported.
import { fail } from "@/lib/http";
import { authenticateApiKey } from "@/lib/apiKeyAuth";
import { loadActiveFile } from "@/lib/services/fileService";
import { serveFile } from "@/lib/fileHttp";
import { recordDownload, recordError } from "@/lib/services/usageService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const auth = await authenticateApiKey(request, "files:read");
  if (auth.error) return auth.error;
  const { key, project } = auth;
  const { fileId } = await params;

  const file = await loadActiveFile(project, fileId);
  if (!file) return fail("FILE_NOT_FOUND", "File not found.");

  const { response, missing } = await serveFile(file, request, {
    attachment: true,
    onServed: (n) => recordDownload(project, key, file._id, n),
  });
  if (missing) {
    console.error("[v1] ORPHAN: metadata exists but physical object is missing:", file.fileId);
    recordError(project, key);
    return fail("FILE_NOT_FOUND", "File not found.");
  }
  return response;
}
