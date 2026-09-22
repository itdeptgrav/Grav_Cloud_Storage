// /api/v1/files/:fileId  (machine plane)
//   GET    → stream (files:read) + Range          HEAD → headers only (files:read)
//   DELETE → soft-delete / trash (files:delete)
import { fail, ok } from "@/lib/http";
import { withLog, setLogCtx } from "@/lib/apiLog";
import { authenticateApiKey } from "@/lib/apiKeyAuth";
import { loadActiveFile, trashFile } from "@/lib/services/fileService";
import { serveFile } from "@/lib/fileHttp";
import getStorageProvider from "@/lib/storage/provider";
import { recordDownload, recordError } from "@/lib/services/usageService";
import { acquireSlot } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLog("get", async (request, { params }) => {
  const auth = await authenticateApiKey(request, "files:read");
  if (auth.error) return auth.error;
  const { key, project } = auth;
  const { fileId } = await params;
  setLogCtx(request, { fileId });
  const file = await loadActiveFile(project, fileId);
  if (!file) return fail("FILE_NOT_FOUND", "File not found.");

  const slot = acquireSlot("download", project._id);
  if (!slot.ok) return fail("TOO_MANY_CONCURRENT_TRANSFERS", `Too many concurrent downloads for this project (max ${slot.limit}).`);
  const { response, missing } = await serveFile(file, request, {
    attachment: false,
    onServed: (n) => { recordDownload(project, key, file._id, n); slot.release(); },
  });
  if (missing) {
    slot.release();
    console.error("[v1] ORPHAN: object missing:", file.fileId);
    recordError(project, key);
    return fail("FILE_NOT_FOUND", "File not found.");
  }
  return response;
});

export const HEAD = withLog("head", async (request, { params }) => {
  const auth = await authenticateApiKey(request, "files:read");
  if (auth.error) return new Response(null, { status: auth.error.status || 401 });
  const { project } = auth;
  const { fileId } = await params;
  setLogCtx(request, { fileId });
  const file = await loadActiveFile(project, fileId);
  if (!file) return new Response(null, { status: 404 });
  const st = await getStorageProvider().stat(file.storageKey);
  if (!st) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 200,
    headers: {
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Length": String(st.bytes),
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});

export const DELETE = withLog("delete", async (request, { params }) => {
  const auth = await authenticateApiKey(request, "files:delete");
  if (auth.error) return auth.error;
  const { project } = auth;
  const { fileId } = await params;
  setLogCtx(request, { fileId });
  const file = await loadActiveFile(project, fileId);
  if (!file) return fail("FILE_NOT_FOUND", "File not found.");
  await trashFile(project, file);
  return ok({ fileId: file.fileId, status: "trashed", trashedAt: file.trashedAt });
});
