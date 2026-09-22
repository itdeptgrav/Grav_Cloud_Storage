// lib/maintenance.js
// Safe, explicit maintenance operations, reused by the admin UI and the CLI
// scripts (no duplicated logic). Scheduling is external (cron / task) — there is
// deliberately NO always-on setInterval that dev reloads would duplicate.
import fs from "fs";
import path from "path";
import getStorageProvider from "@/lib/storage/provider";
import FileObject from "@/lib/db/models/FileObject";
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
