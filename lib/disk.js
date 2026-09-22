// lib/disk.js
// Physical disk + logical storage figures. Uses OS statfs on the storage volume
// (O(1) — never a recursive scan of the data dir) and cheap DB aggregates for
// active/trash bytes. The three numbers are kept explicitly distinct:
//   activeStorage — bytes of active files (quota-relevant)
//   trashStorage  — bytes of trashed files still on disk (pending purge)
//   gravUsage     — active + trash = what Grav Storage physically holds
import fs from "fs";
import getStorageProvider from "@/lib/storage/provider";
import { connectDB } from "@/lib/db/mongoose";
import FileObject from "@/lib/db/models/FileObject";
import Project from "@/lib/db/models/Project";

export async function volumeStats() {
  try {
    const dir = getStorageProvider().dirs?.DATA_DIR;
    const s = await fs.promises.statfs(dir);
    const capacity = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { ok: true, capacity, free, used: capacity - free };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Sum bytes by status (optionally within one project). Cheap aggregate — no scan.
export async function storageBytes({ projectId } = {}) {
  await connectDB();
  const match = projectId ? { projectId } : {};
  const rows = await FileObject.aggregate([
    { $match: match },
    { $group: { _id: "$status", bytes: { $sum: "$sizeBytes" }, count: { $sum: 1 } } },
  ]);
  const out = { active: 0, trashed: 0, activeCount: 0, trashedCount: 0 };
  for (const r of rows) {
    if (r._id === "active") { out.active = r.bytes; out.activeCount = r.count; }
    else if (r._id === "trashed") { out.trashed = r.bytes; out.trashedCount = r.count; }
  }
  return out;
}

/** Global disk report for the super-admin. */
export async function diskReport() {
  const vol = await volumeStats();
  const bytes = await storageBytes();
  const gravUsage = bytes.active + bytes.trashed;
  const lowSpaceWarning = vol.ok ? vol.used / vol.capacity >= 0.9 : false;
  return {
    volume: vol,
    activeStorage: bytes.active,
    trashStorage: bytes.trashed,
    gravUsage,
    activeCount: bytes.activeCount,
    trashedCount: bytes.trashedCount,
    lowSpaceWarning,
  };
}

/** Global platform totals for the super-admin overview. */
export async function globalTotals() {
  await connectDB();
  const [users, totalProjects, projAgg] = await Promise.all([
    (await import("@/lib/db/models/User")).default.countDocuments({}),
    Project.countDocuments({}),
    Project.aggregate([
      {
        $group: {
          _id: null,
          currentStorageBytes: { $sum: "$currentStorageBytes" },
          fileCount: { $sum: "$fileCount" },
          uploads: { $sum: "$counters.uploads" },
          downloads: { $sum: "$counters.downloads" },
          bytesUp: { $sum: "$counters.bytesUp" },
          bytesDown: { $sum: "$counters.bytesDown" },
          requests: { $sum: "$counters.requests" },
          errors: { $sum: "$counters.errors" },
        },
      },
    ]),
  ]);
  const a = projAgg[0] || {};
  const largest = await Project.find({}).sort({ currentStorageBytes: -1 }).limit(5).select("name currentStorageBytes fileCount status");
  return {
    users,
    projects: totalProjects,
    currentStorageBytes: a.currentStorageBytes || 0,
    fileCount: a.fileCount || 0,
    uploads: a.uploads || 0,
    downloads: a.downloads || 0,
    bytesUp: a.bytesUp || 0,
    bytesDown: a.bytesDown || 0,
    requests: a.requests || 0,
    errors: a.errors || 0,
    largestProjects: largest.map((p) => ({ id: String(p._id), name: p.name, currentStorageBytes: p.currentStorageBytes, fileCount: p.fileCount, status: p.status })),
  };
}
