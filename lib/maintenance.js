// lib/maintenance.js
// Safe, explicit maintenance operations, reused by the admin UI and the CLI
// scripts (no duplicated logic). Scheduling is external (cron / task) — there is
// deliberately NO always-on setInterval that dev reloads would duplicate.
import fs from "fs";
import path from "path";
import getStorageProvider from "@/lib/storage/provider";
import FileObject from "@/lib/db/models/FileObject";
import UploadSession from "@/lib/db/models/UploadSession";
import { connectDB } from "@/lib/db/mongoose";
import config from "@/lib/config";

/** Remove stale tmp/*.part left by crashes. Never touches a recent (active)
 *  upload — only .part files older than the threshold. */
export async function cleanTempFiles({ maxAgeHours } = {}) {
  const dir = getStorageProvider().dirs.TMP_DIR;
  const cutoff = Date.now() - (maxAgeHours ?? config.tmpMaxAgeHours) * 3600 * 1000;
  let removed = 0;
  let bytes = 0;
  let entries = [];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return { removed, bytes };
  }
  for (const name of entries) {
    if (!name.endsWith(".part")) continue;
    const p = path.join(dir, name);
    try {
      const s = await fs.promises.stat(p);
      if (s.mtimeMs < cutoff) {
        await fs.promises.unlink(p);
        removed++;
        bytes += s.size;
      }
    } catch {
      /* skip */
    }
  }
  return { removed, bytes };
}

/** Permanently purge trashed files older than TRASH_RETENTION_DAYS. Destructive
 *  but bounded to already-trashed items past retention. */
export async function purgeExpiredTrash({ retentionDays } = {}) {
  await connectDB();
  const cutoff = new Date(Date.now() - (retentionDays ?? config.trashRetentionDays) * 86400 * 1000);
  const files = await FileObject.find({ status: "trashed", trashedAt: { $lte: cutoff } });
  const provider = getStorageProvider();
  let purged = 0;
  let bytes = 0;
  for (const f of files) {
    await provider.removeFromTrash(f.storageKey).catch(() => {});
    f.status = "purged";
    await f.save();
    purged++;
    bytes += f.sizeBytes;
  }
  return { purged, bytes };
}

/**
 * Chunked-upload housekeeping (safe to run any time, from the CLI or the admin
 * page, while uploads are in progress):
 *  1. Sessions idle past their expiry → temp file deleted, status "expired".
 *  2. Sessions stuck in "completing" (a finalize interrupted by a crash) →
 *     temp file deleted, status "failed".
 *  3. Orphaned temp files in tmp/chunked/ (no live session references them —
 *     e.g. a crash between creating the temp and saving the session) older than
 *     CHUNK_ORPHAN_MIN_AGE_MINUTES → deleted.
 * A live session's temp file is NEVER deleted, however old its mtime: liveness
 * comes from the session record, not from the file clock. Slot leases need no
 * work here — the server stops counting a lease once its expiry passes.
 */
export async function cleanChunkSessions({ orphanMinAgeMinutes } = {}) {
  await connectDB();
  const provider = getStorageProvider();
  const now = new Date();
  const purgeAt = new Date(Date.now() + config.chunkSessionRetentionDays * 86400000);
  const out = { expired: 0, interrupted: 0, orphansRemoved: 0, bytesFreed: 0 };

  const stale = await UploadSession.find({ status: "active", expiresAt: { $lte: now } });
  for (const s of stale) {
    const st = await provider.statChunkTemp(s.tmpObjId);
    await provider.removeChunkTemp(s.tmpObjId).catch(() => {});
    const r = await UploadSession.updateOne({ _id: s._id, status: "active" }, { $set: { status: "expired", purgeAt } });
    if (r.modifiedCount) {
      out.expired++;
      out.bytesFreed += st?.bytes || 0;
    }
  }

  const stuckBefore = new Date(Date.now() - config.chunkCompletingStaleMinutes * 60000);
  const stuck = await UploadSession.find({ status: "completing", completingAt: { $lte: stuckBefore } });
  for (const s of stuck) {
    const st = await provider.statChunkTemp(s.tmpObjId);
    await provider.removeChunkTemp(s.tmpObjId).catch(() => {});
    const r = await UploadSession.updateOne(
      { _id: s._id, status: "completing" },
      { $set: { status: "failed", failureCode: "UPLOAD_FINALIZE_INTERRUPTED", purgeAt } },
    );
    if (r.modifiedCount) {
      out.interrupted++;
      out.bytesFreed += st?.bytes || 0;
    }
  }

  const live = new Set(
    (await UploadSession.find({ status: { $in: ["active", "completing"] } }).select("tmpObjId").lean()).map((s) => s.tmpObjId),
  );
  const cutoff = Date.now() - (orphanMinAgeMinutes ?? config.chunkOrphanMinAgeMinutes) * 60000;
  for (const t of await provider.listChunkTemps()) {
    if (live.has(t.objId) || t.mtimeMs > cutoff) continue;
    if (await provider.removeChunkTemp(t.objId).catch(() => false)) {
      out.orphansRemoved++;
      out.bytesFreed += t.bytes;
    }
  }
  return out;
}
