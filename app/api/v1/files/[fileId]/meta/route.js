// GET /api/v1/files/:fileId/meta — safe metadata JSON (scope files:read).
// No storageKey, no physical path, no internal fields.
import { ok, fail } from "@/lib/http";
import { authenticateApiKey } from "@/lib/apiKeyAuth";
import { loadActiveFile } from "@/lib/services/fileService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const auth = await authenticateApiKey(request, "files:read");
  if (auth.error) return auth.error;
  const { project } = auth;
  const { fileId } = await params;
  const file = await loadActiveFile(project, fileId);
  if (!file) return fail("FILE_NOT_FOUND", "File not found.");
  return ok({ file: file.toMeta() });
}
