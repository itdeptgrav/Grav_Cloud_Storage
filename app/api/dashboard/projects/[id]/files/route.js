// /api/dashboard/projects/:id/files  (session plane — human)
//   GET  → list (status active|trashed), project-scoped, paginated
//   POST → upload via the SAME ingest engine as /api/v1 (no API key in browser)
import { ok, fail } from "@/lib/http";
import { requireProject } from "@/lib/dashboardAuth";
import { listFiles } from "@/lib/services/fileService";
import { ingestUpload } from "@/lib/fileIngest";
import { recordError } from "@/lib/services/usageService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id } = await params;
  const { project, error } = await requireProject(id);
  if (error) return error;
  const url = new URL(request.url);
  const data = await listFiles(project, Object.fromEntries(url.searchParams.entries()));
  return ok(data);
}

export async function POST(request, { params }) {
  const { id } = await params;
  const { user, project, error } = await requireProject(id);
  if (error) return error;

  const r = await ingestUpload(request, { project, user }); // attributed to the human, no API key
  if (!r.ok) {
    recordError(project, null);
    return fail(r.code, r.message);
  }
  return ok({ file: r.doc.toMeta(), fileId: r.doc.fileId }, { status: 201 });
}
