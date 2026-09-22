// /api/v1/files  (machine plane — API key)
//   POST → upload (scope files:write) — streamed, quota-gated, concurrency-slotted
//   GET  → list  (scope files:list)
import { ok, fail } from "@/lib/http";
import config from "@/lib/config";
import { withLog } from "@/lib/apiLog";
import { authenticateApiKey } from "@/lib/apiKeyAuth";
import { ingestUpload } from "@/lib/fileIngest";
import { recordError } from "@/lib/services/usageService";
import { listFiles } from "@/lib/services/fileService";
import { acquireSlot } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withLog("upload", async (request) => {
  const t0 = process.hrtime.bigint();
  const auth = await authenticateApiKey(request, "files:write");
  if (auth.error) return auth.error;
  const { key, project } = auth;

  const slot = acquireSlot("upload", project._id);
  if (!slot.ok) return fail("TOO_MANY_CONCURRENT_TRANSFERS", `Too many concurrent uploads for this project (max ${slot.limit}).`);
  try {
    const r = await ingestUpload(request, { project, apiKey: key });
    if (!r.ok) {
      recordError(project, key);
      return fail(r.code, r.message);
    }
    const doc = r.doc;
    const res = ok(
      { fileId: doc.fileId, name: doc.originalName, mimeType: doc.mimeType, extension: doc.extension, sizeBytes: doc.sizeBytes, checksumSha256: doc.checksumSha256, createdAt: doc.createdAt },
      { status: 201 },
    );
    if (config.perfHeaders) {
      const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;
      res.headers.set("Server-Timing", `total;dur=${totalMs.toFixed(1)}`);
      res.headers.set("Timing-Allow-Origin", "*");
      res.headers.set("Access-Control-Expose-Headers", "Server-Timing");
    }
    return res;
  } finally {
    slot.release();
  }
});

export const GET = withLog("list", async (request) => {
  const auth = await authenticateApiKey(request, "files:list");
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  delete params.status; // machine list is active-only
  return ok(await listFiles(auth.project, params));
});
