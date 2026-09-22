// app/api/health/route.js
// GET /api/health — public, deliberately MINIMAL.
//
// Reports whether the API, database and storage provider are up. It does NOT
// expose paths, versions, disk figures or any server internals — those belong
// only on the authenticated admin dashboard (Phase 3+). See the brief §15.

import { NextResponse } from "next/server";
import { pingDatabase } from "@/lib/db/mongoose";
import { checkStorageAccess } from "@/lib/storage/localProvider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [db, storage] = await Promise.all([pingDatabase(), checkStorageAccess()]);

  const checks = {
    api: "up",
    database: db.ok ? "up" : "down",
    storage: storage.ok ? "up" : "down",
  };
  const status = Object.values(checks).every((v) => v === "up") ? "ok" : "degraded";

  return NextResponse.json(
    { status, service: "grav-storage", checks, time: new Date().toISOString() },
    { status: status === "ok" ? 200 : 503 },
  );
}
