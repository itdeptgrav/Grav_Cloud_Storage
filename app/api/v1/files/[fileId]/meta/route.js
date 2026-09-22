// GET /api/v1/files/:fileId/meta — safe metadata JSON (files:read).
import { ok, fail } from "@/lib/http";
import { withLog, setLogCtx } from "@/lib/apiLog";
import { authenticateApiKey } from "@/lib/apiKeyAuth";
import { loadActiveFile } from "@/lib/services/fileService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLog("meta", async (request, { params }) => {
  const auth = await authenticateApiKey(request, "files:read");
  if (auth.error) return auth.error;
  const { fileId } = await params;
  setLogCtx(request, { fileId });
  const file = await loadActiveFile(auth.project, fileId);
  if (!file) return fail("FILE_NOT_FOUND", "File not found.");
  return ok({ file: file.toMeta() });
});
