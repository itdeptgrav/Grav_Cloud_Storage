// GET /api/dashboard/overview — session summary.
//   super-admin → global platform totals + disk report
//   user        → totals aggregated over THEIR projects only
import { ok } from "@/lib/http";
import { requireUser } from "@/lib/auth/guards";
import { connectDB } from "@/lib/db/mongoose";
import Project from "@/lib/db/models/Project";
import { globalTotals, diskReport } from "@/lib/disk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, error } = await requireUser();
  if (error) return error;
  await connectDB();

  if (user.role === "superadmin") {
    const [totals, disk] = await Promise.all([globalTotals(), diskReport()]);
    return ok({ role: "superadmin", totals, disk });
  }

  const projects = await Project.find({ ownerId: user._id });
  const totals = projects.reduce(
    (a, p) => {
      a.projects += 1;
      a.currentStorageBytes += p.currentStorageBytes || 0;
      a.fileCount += p.fileCount || 0;
      a.uploads += p.counters?.uploads || 0;
      a.downloads += p.counters?.downloads || 0;
      a.bytesUp += p.counters?.bytesUp || 0;
      a.bytesDown += p.counters?.bytesDown || 0;
      a.requests += p.counters?.requests || 0;
      a.errors += p.counters?.errors || 0;
      return a;
    },
    { projects: 0, currentStorageBytes: 0, fileCount: 0, uploads: 0, downloads: 0, bytesUp: 0, bytesDown: 0, requests: 0, errors: 0 },
  );
  return ok({ role: "user", totals });
}
