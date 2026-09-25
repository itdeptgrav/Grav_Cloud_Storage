// /api/dashboard/projects/:id/files/chunk  (session plane)
// Chunked/resumable upload for files above the proxy body cap. Same auth + CSRF
// as the normal dashboard upload; the heavy lifting is shared in lib/chunkedUploads.
//   POST ?op=begin | append | complete | abort   (see lib/chunkedUploads.js)
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
  return handleChunkRequest(request, { project, user });
});
