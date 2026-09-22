// lib/integrity.js
// Report-first integrity checker (plan §18/§19). It NEVER deletes or rewrites
// anything — it only produces a report. Quick = existence + size + orphans;
// Full = also streaming SHA-256 verification of active objects.
import FileObject from "@/lib/db/models/FileObject";
import getStorageProvider from "@/lib/storage/provider";
import { connectDB } from "@/lib/db/mongoose";

export async function runIntegrityCheck({ full = false } = {}) {
  await connectDB();
  const provider = getStorageProvider();
  const started = Date.now();
  const problems = [];
  let checked = 0;
  let healthy = 0;

  // ── DB → disk ──
  const files = await FileObject.find({ status: { $in: ["active", "trashed"] } }).select(
    "fileId projectId status storageKey sizeBytes checksumSha256",
  );
  const activeKeys = new Set();
  const trashKeys = new Set();
  for (const f of files) {
    checked++;
    if (f.status === "active") activeKeys.add(f.storageKey);
    else trashKeys.add(f.storageKey);
    const st = f.status === "trashed" ? await provider.statTrash(f.storageKey) : await provider.stat(f.storageKey);
    if (!st) {
      problems.push({ type: "missing_file", fileId: f.fileId, projectId: String(f.projectId), status: f.status });
      continue;
    }
    if (st.bytes !== f.sizeBytes) {
      problems.push({ type: "size_mismatch", fileId: f.fileId, expected: f.sizeBytes, actual: st.bytes });
      continue;
    }
    if (full && f.status === "active") {
      try {
        const actual = await provider.sha256Of(f.storageKey);
        if (actual !== f.checksumSha256) {
          problems.push({ type: "checksum_mismatch", fileId: f.fileId });
          continue;
        }
      } catch {
        problems.push({ type: "missing_file", fileId: f.fileId, status: f.status });
        continue;
      }
    }
    healthy++;
  }

  // ── disk → DB (orphan objects with no metadata) ──
  for (const key of await provider.listDataObjects()) {
    if (!activeKeys.has(key)) problems.push({ type: "orphan_object", location: "data", storageKey: key });
  }
  for (const key of await provider.listTrashObjects()) {
    if (!trashKeys.has(key)) problems.push({ type: "orphan_object", location: "trash", storageKey: key });
  }

  return {
    type: full ? "full" : "quick",
    checked,
    healthy,
    problems,
    problemCount: problems.length,
    durationMs: Date.now() - started,
    at: new Date().toISOString(),
  };
}
