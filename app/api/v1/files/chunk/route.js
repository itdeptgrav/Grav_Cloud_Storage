// /api/v1/files/chunk  (machine plane — API key, scope files:write)
// The same chunked upload as the dashboard plane, for server-side clients. The
// session is bound to THE API KEY that began it.
//   POST ?op=begin | append | complete | abort
//   GET  ?op=status | list
// Contract: docs/chunked-upload-api.md · engine: lib/chunkedUploads.js
import { withLog } from "@/lib/apiLog";
import { authenticateApiKey } from "@/lib/apiKeyAuth";
import { handleChunkRequest } from "@/lib/chunkedUploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request) {
  const auth = await authenticateApiKey(request, "files:write");
  if (auth.error) return auth.error;
  return handleChunkRequest(request, { plane: "api", project: auth.project, apiKey: auth.key });
}

export const POST = withLog("chunk", handle);
export const GET = withLog("chunk", handle);
