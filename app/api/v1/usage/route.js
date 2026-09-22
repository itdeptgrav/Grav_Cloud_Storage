// GET /api/v1/usage — the calling key's project usage (scope files:read).
// currentStorageBytes/fileCount are live; bytesUploaded/Downloaded are
// historical (never decrease). quotaBytes null = unlimited.
import { ok } from "@/lib/http";
import { withLog } from "@/lib/apiLog";
import { authenticateApiKey } from "@/lib/apiKeyAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLog("usage", async (request) => {
  const { project, error } = await authenticateApiKey(request, "files:read");
  if (error) return error;
  const c = project.counters || {};
  return ok({
    currentStorageBytes: project.currentStorageBytes || 0,
    fileCount: project.fileCount || 0,
    quotaBytes: project.quotaBytes ?? null,
    uploads: c.uploads || 0,
    downloads: c.downloads || 0,
    bytesUploaded: c.bytesUp || 0,
    bytesDownloaded: c.bytesDown || 0,
    requests: c.requests || 0,
    errors: c.errors || 0,
  });
});
