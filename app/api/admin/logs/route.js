// GET /api/admin/logs — super-admin GLOBAL request log (cross-project).
// Normal users never reach this (requireAdmin). Optional filters incl projectId.
import { ok } from "@/lib/http";
import { requireAdmin } from "@/lib/auth/guards";
import { listRequestLogs } from "@/lib/services/logService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const { error } = await requireAdmin();
  if (error) return error;
  const url = new URL(request.url);
  return ok(await listRequestLogs(null, Object.fromEntries(url.searchParams.entries())));
}
