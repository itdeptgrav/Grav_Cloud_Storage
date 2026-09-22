// /api/dashboard/projects/:id/files  (session plane)
//   GET  → list (status active|trashed), project-scoped, paginated
//   POST → upload via the SAME ingest engine as /api/v1 (quota-gated, streamed)
import { ok, fail } from "@/lib/http";
import { withLog } from "@/lib/apiLog";
import { requireProject } from "@/lib/dashboardAuth";
import { listFiles } from "@/lib/services/fileService";
import { ingestUpload } from "@/lib/fileIngest";
import { recordError } from "@/lib/services/usageService";
import { acquireSlot } from "@/lib/limits";
import { csrfGuard } from "@/lib/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLog("list", async (request, { params }) => {
  const { id } = await params;
  const { project, error } = await requireProject(request, id);
  if (error) return error;
  const url = new URL(request.url);
  return ok(await listFiles(project, Object.fromEntries(url.searchParams.entries())));
});

export const POST = withLog("upload", async (request, { params }) => {
  const csrf = csrfGuard(request);
  if (csrf) return csrf;
  const { id } = await params;
  const { user, project, error } = await requireProject(request, id);
  if (error) return error;

  const slot = acquireSlot("upload", project._id);
  if (!slot.ok) return fail("TOO_MANY_CONCURRENT_TRANSFERS", `Too many concurrent uploads for this project (max ${slot.limit}).`);
  try {
    const r = await ingestUpload(request, { project, user });
    if (!r.ok) {
      recordError(project, null);
      return fail(r.code, r.message);
    }
    return ok({ file: r.doc.toMeta(), fileId: r.doc.fileId }, { status: 201 });
  } finally {
    slot.release(); // always released: success, error, or thrown
  }
});
