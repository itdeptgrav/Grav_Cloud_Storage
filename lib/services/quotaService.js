// lib/services/quotaService.js
// Atomic, race-safe storage accounting. The authoritative quota gate is the
// CONDITIONAL increment in commitStorage(): concurrent uploads that would
// together exceed quota cannot both succeed — the second's increment fails and
// the caller rolls its bytes back (plan §9).
import Project from "@/lib/db/models/Project";
import { connectDB } from "@/lib/db/mongoose";
import { volumeStats } from "@/lib/disk";
import config from "@/lib/config";

/**
 * Atomically add `bytes` (+1 file) to a project's active storage IFF it stays
 * within quota. Returns true on success, false if it would exceed quota.
 * quotaBytes null/absent = unlimited (unconditional increment).
 */
export async function commitStorage(projectId, bytes) {
  await connectDB();
  const res = await Project.findOneAndUpdate(
    {
      _id: projectId,
      $or: [
        { quotaBytes: null },
        { quotaBytes: { $exists: false } },
        { $expr: { $lte: [{ $add: ["$currentStorageBytes", bytes] }, "$quotaBytes"] } },
      ],
    },
    { $inc: { currentStorageBytes: bytes, fileCount: 1 } },
    { new: true },
  );
  return !!res;
}

/** Reverse a commitStorage (rollback on a later failure, or on trash). */
export async function releaseStorage(projectId, bytes) {
  await connectDB();
  await Project.updateOne({ _id: projectId }, { $inc: { currentStorageBytes: -bytes, fileCount: -1 } }).catch(() => {});
}

/** Snapshot headroom for the mid-stream limit. quota null → Infinity. */
export function quotaHeadroom(project) {
  if (project.quotaBytes == null) return Infinity;
  return Math.max(0, project.quotaBytes - (project.currentStorageBytes || 0));
}

/**
 * Physical-disk safety, independent of quota (plan §23/§24). Rejects when the
 * volume's free space would drop below MIN_FREE_DISK_BYTES. `knownBytes` is the
 * Content-Length when available (0 if unknown).
 * Returns { ok } or { ok:false }.
 */
export async function checkDiskFree(knownBytes = 0) {
  if (!config.minFreeDiskBytes) return { ok: true };
  const vol = await volumeStats();
  if (!vol.ok) return { ok: true }; // can't measure → don't block
  const projectedFree = vol.free - (knownBytes || 0);
  if (projectedFree < config.minFreeDiskBytes) return { ok: false, free: vol.free };
  return { ok: true, free: vol.free };
}
