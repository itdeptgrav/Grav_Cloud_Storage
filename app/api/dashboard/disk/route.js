// GET /api/dashboard/disk — super-admin only. Physical volume stats + the
// active/trash/actual storage distinction. Uses OS statfs + DB aggregates only.
import { ok } from "@/lib/http";
import { requireAdmin } from "@/lib/auth/guards";
import { diskReport } from "@/lib/disk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  return ok(await diskReport());
}
