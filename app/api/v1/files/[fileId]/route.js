// /api/v1/files/:fileId
//   GET    → stream the object (scope files:read), with HTTP Range support
//   HEAD   → metadata headers only (scope files:read)
//   DELETE → soft-delete / trash (scope files:delete)
//
// Project isolation: every lookup is scoped to the caller's project, so a
// fileId from another project resolves to nothing → 404 FILE_NOT_FOUND.
import { fail, ok } from "@/lib/http";
import config from "@/lib/config";
import { authenticateApiKey } from "@/lib/apiKeyAuth";
import { loadActiveFile, trashFile } from "@/lib/services/fileService";
import { serveFile } from "@/lib/fileHttp";
import getStorageProvider from "@/lib/storage/provider";
import { recordDownload, recordError } from "@/lib/services/usageService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function perf(auth, extra) {
  if (!config.perfHeaders) return undefined;
  return {
    "Server-Timing": Object.entries(extra)
      .map(([k, v]) => `${k};dur=${Number(v).toFixed(1)}`)
      .join(", "),
    "Timing-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Server-Timing, Content-Range, Accept-Ranges",
  };
}

export async function GET(request, { params }) {
  const authStart = process.hrtime.bigint();
  const auth = await authenticateApiKey(request, "files:read");
  const authMs = Number(process.hrtime.bigint() - authStart) / 1e6;
  if (auth.error) return auth.error;
  const { key, project } = auth;
  const { fileId } = await params;

  const lookupStart = process.hrtime.bigint();
  const file = await loadActiveFile(project, fileId);
  const lookupMs = Number(process.hrtime.bigint() - lookupStart) / 1e6;
  if (!file) return fail("FILE_NOT_FOUND", "File not found.");

  const { response, missing } = await serveFile(file, request, {
    attachment: false,
    extraHeaders: perf(auth, { auth: authMs, lookup: lookupMs }),
    onServed: (n) => recordDownload(project, key, file._id, n),
  });
  if (missing) {
    console.error("[v1] ORPHAN: metadata exists but physical object is missing:", file.fileId);
    recordError(project, key);
    return fail("FILE_NOT_FOUND", "File not found.");
  }
  return response;
}

export async function HEAD(request, { params }) {
  const auth = await authenticateApiKey(request, "files:read");
  if (auth.error) return new Response(null, { status: auth.error.status || 401 });
  const { project } = auth;
  const { fileId } = await params;
  const file = await loadActiveFile(project, fileId);
  if (!file) return new Response(null, { status: 404 });

  const provider = getStorageProvider();
  const st = await provider.stat(file.storageKey);
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
}

export async function DELETE(request, { params }) {
  const auth = await authenticateApiKey(request, "files:delete");
  if (auth.error) return auth.error;
  const { project } = auth;
  const { fileId } = await params;

  const file = await loadActiveFile(project, fileId);
  if (!file) return fail("FILE_NOT_FOUND", "File not found.");

  await trashFile(project, file); // shared soft-delete (DB first, then bytes→trash)
  return ok({ fileId: file.fileId, status: "trashed", trashedAt: file.trashedAt });
}
