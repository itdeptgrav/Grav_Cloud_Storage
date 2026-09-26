// /api/dashboard/projects/:id/files/chunk  (session plane)
// Chunked upload for files above the proxy body cap. Session auth; every POST is
// CSRF-guarded exactly like the normal dashboard upload. The session is bound to
// THIS signed-in user — nobody else (not even another admin) can drive it.
//   POST ?op=begin | append | complete | abort
//   GET  ?op=status | list
// Contract: docs/chunked-upload-api.md · engine: lib/chunkedUploads.js
import { withLog } from "@/lib/apiLog";
import { requireProject } from "@/lib/dashboardAuth";
import { csrfGuard } from "@/lib/csrf";
import { handleChunkRequest } from "@/lib/chunkedUploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withLog("chunk", async (request, { params }) => {
  const csrf = csrfGuard(request);
  if (csrf) return csrf;
  const { id } = await params;
  const { user, project, error } = await requireProject(request, id);
  if (error) return error;
  return handleChunkRequest(request, { plane: "dashboard", project, user });
});

export const GET = withLog("chunk", async (request, { params }) => {
  const { id } = await params;
  const { user, project, error } = await requireProject(request, id);
  if (error) return error;
  return handleChunkRequest(request, { plane: "dashboard", project, user });
});
