// /api/v1/files/chunk  (machine plane — API key, scope files:write)
// Chunked/resumable upload for external clients (the same feature as the dashboard
// plane), so an app behind a proxy body cap can still upload large files.
//   POST ?op=begin | append | complete | abort   (see lib/chunkedUploads.js)
import { withLog } from "@/lib/apiLog";
import { authenticateApiKey } from "@/lib/apiKeyAuth";
import { handleChunkRequest } from "@/lib/chunkedUploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withLog("chunk", async (request) => {
  const auth = await authenticateApiKey(request, "files:write");
  if (auth.error) return auth.error;
  return handleChunkRequest(request, { project: auth.project, apiKey: auth.key });
});
