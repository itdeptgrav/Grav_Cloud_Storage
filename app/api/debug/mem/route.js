// GET /api/debug/mem — DEV-ONLY process memory (for the ~900 MB streaming
// benchmark). A couple of numbers, no secrets, no paths. 404 in production and
// whenever perf headers are off. (Note: NOT under an underscore folder — Next
// treats `_name` folders as private/non-routable.)
import { NextResponse } from "next/server";
import config from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!config.perfHeaders) return new NextResponse(null, { status: 404 });
  const m = process.memoryUsage();
  return NextResponse.json({ rss: m.rss, heapUsed: m.heapUsed, external: m.external });
}
