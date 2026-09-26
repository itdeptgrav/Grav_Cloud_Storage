// lib/services/projectDeletion.js
// PERMANENT project deletion: every byte and record the project owns, then the
// project itself. Reached only from the session plane (/api/projects/:id/permanent),
// by the project's owner or a super-admin.
//
// Stages, in order. Each is idempotent, so a deletion that failed part-way is
// simply run again (the project stays "deleting" until one run gets through):
//   start      status → "deleting" (one-way); the project is retired in this process
//   fence      wait for writes already inside the write fence (lib/projectGuard)
//   transfers  cancel downloads and single-request uploads still streaming
//   uploads    abort chunk appends, close every upload session, remove its temp file
//   files      the bytes of every file record — active and trashed
//   storage    the project's data/ and trash/ directories (strays, empty folders)
//   records    upload sessions, file records, API keys, usage rollups, request logs
//   verify     sweep once more, then prove nothing of the project is left
//   project    the project record — last
// Bytes go before the records that point at them: if a stage fails, the records
// still describe what is left and the retry finds it.
//
// Audit policy: audit history is RETAINED. Earlier entries about the project stay;
// this adds project.delete_started, project.delete_failed (stage + error code) and
// project.permanently_deleted (who, when, the counts). Never a secret or a path.
import { connectDB } from "@/lib/db/mongoose";
import Project from "@/lib/db/models/Project";
import FileObject from "@/lib/db/models/FileObject";
import UploadSession from "@/lib/db/models/UploadSession";
import ApiKey from "@/lib/db/models/ApiKey";
import UsageDaily from "@/lib/db/models/UsageDaily";
import RequestLog from "@/lib/db/models/RequestLog";
import AuditLog from "@/lib/db/models/AuditLog";
import getStorageProvider from "@/lib/storage/provider";
import { closeProjectUploads } from "@/lib/chunkedUploads";
import { retireProject, drainProjectWrites, cancelProjectTransfers } from "@/lib/projectGuard";
import { recordAudit } from "@/lib/services/auditService";
import { logError } from "@/lib/logSafe";

// One deletion per project at a time (this process — see lib/projectGuard).
const running = globalThis.__gsProjectDeletions || (globalThis.__gsProjectDeletions = new Set());
const FENCE_WAIT_MS = 30000;
const TRANSFER_WAIT_MS = 15000;
const SETTLE_MS = 300; // let fire-and-forget writes of requests that just ended land
const FILE_CONCURRENCY = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const coded = (code, message) => Object.assign(new Error(message || code), { code });

/** Real counts of what a permanent deletion would remove (for the confirmation dialog). */
export async function deletionSummary(project) {
  await connectDB();
  const projectId = project._id;
  const [files, keys, sessions, requestLogs, usageRows] = await Promise.all([
    FileObject.aggregate([{ $match: { projectId } }, { $group: { _id: "$status", count: { $sum: 1 }, bytes: { $sum: "$sizeBytes" } } }]),
    ApiKey.aggregate([{ $match: { projectId } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    UploadSession.aggregate([{ $match: { projectId } }, { $group: { _id: "$status", count: { $sum: 1 }, bytes: { $sum: "$bytesReceived" } } }]),
    RequestLog.countDocuments({ projectId }),
    UsageDaily.countDocuments({ projectId }),
  ]);
  const of = (rows, status) => rows.find((r) => r._id === status) || { count: 0, bytes: 0 };
  const sum = (rows, field) => rows.reduce((a, r) => a + (r[field] || 0), 0);
  const open = sessions.filter((r) => r._id === "active" || r._id === "completing");
  return {
    activeFiles: of(files, "active").count,
    activeBytes: of(files, "active").bytes,
    trashedFiles: of(files, "trashed").count,
    trashedBytes: of(files, "trashed").bytes,
    purgedRecords: of(files, "purged").count,
    apiKeys: sum(keys, "count"),
    activeApiKeys: of(keys, "active").count,
    uploadSessions: sum(sessions, "count"),
    openUploads: sum(open, "count"),
    openUploadBytes: sum(open, "bytes"),
    requestLogs,
    usageRows,
  };
}

// Each of the project's records, by collection — the same filters the deletion
// uses, so "nothing left" is checked against exactly what was deleted.
function recordFilters(projectId, keyIds) {
  return {
    uploadSessions: [UploadSession, { projectId }],
    fileRecords: [FileObject, { projectId }],
    apiKeys: [ApiKey, { projectId }],
    usageRows: [UsageDaily, { $or: [{ projectId }, { scope: "project", refId: projectId }, ...(keyIds.length ? [{ scope: "key", refId: { $in: keyIds } }] : [])] }],
    requestLogs: [RequestLog, { $or: [{ projectId }, ...(keyIds.length ? [{ apiKeyId: { $in: keyIds } }] : [])] }],
  };
}

async function deleteRecords(projectId, keyIds, counts) {
  for (const [name, [Model, filter]] of Object.entries(recordFilters(projectId, keyIds))) {
    const r = await Model.deleteMany(filter);
    counts[name] = (counts[name] || 0) + (r.deletedCount || 0);
  }
}

/** Everything of the project still present — empty array when it is all gone. */
async function leftovers(project, keyIds, tmpObjIds) {
  const left = [];
  for (const [name, [Model, filter]] of Object.entries(recordFilters(project._id, keyIds))) {
    const n = await Model.countDocuments(filter);
    if (n) left.push(`${name}:${n}`);
  }
  const provider = getStorageProvider();
  const disk = await provider.projectStorageUsage(String(project._id));
  if (disk.exists) left.push(`storage:${disk.data.files + disk.trash.files}`);
  let temps = 0;
  for (const t of tmpObjIds) if (await provider.statChunkTemp(t)) temps++;
  if (temps) left.push(`uploadTemps:${temps}`);
  return left;
}

// Run fn over items, `limit` at a time. The first error stops new work; it is
// thrown once every call already running has settled (nothing left in flight).
async function pool(items, limit, fn) {
  let next = 0;
  let firstError = null;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!firstError && next < items.length) {
      try {
        await fn(items[next++]);
      } catch (e) {
        firstError ??= e;
      }
    }
  });
  await Promise.all(workers);
  if (firstError) throw firstError;
}

/**
 * Delete the project permanently. Returns { ok:true, counts } only when every
 * stage finished and nothing of the project is left; otherwise
 * { ok:false, code, stage, errorCode } with the project left "deleting" (retry).
 */
export async function deleteProjectPermanently(project, { user, ip, requestId } = {}) {
  const id = String(project._id);
  if (running.has(id)) return { ok: false, code: "PROJECT_DELETE_IN_PROGRESS" };
  running.add(id);
  const t0 = Date.now();
  const counts = {};
  let stage = "start";
  let keyIds = [];
  try {
    await connectDB();
    const provider = getStorageProvider();

    // ── start — one-way: from here on the project accepts nothing new ──
    const first = project.status !== "deleting";
    const set = { status: "deleting", "deletion.stage": "start", "deletion.lastErrorCode": null, "deletion.lastErrorAt": null };
    if (first) Object.assign(set, { "deletion.startedAt": new Date(), "deletion.byUserId": user?._id || null, "deletion.previousStatus": project.status });
    const marked = await Project.findOneAndUpdate({ _id: project._id }, { $set: set, $inc: { "deletion.attempts": 1 } }, { new: true });
    if (!marked) throw coded("PROJECT_GONE");
    retireProject(id);
    recordAudit({
      user,
      action: "project.delete_started",
      targetType: "project",
      targetId: id,
      projectId: project._id,
      details: { name: marked.name, attempt: marked.deletion?.attempts || 1, previousStatus: marked.deletion?.previousStatus || null, requestId },
      ip,
    });

    // ── fence — commits already under way finish before anything is counted ──
    stage = "fence";
    if (!(await drainProjectWrites(id, FENCE_WAIT_MS))) throw coded("FENCE_TIMEOUT");

    // ── transfers — nothing may still be reading or writing the project's bytes ──
    stage = "transfers";
    const t = await cancelProjectTransfers(id, TRANSFER_WAIT_MS);
    counts.transfersCancelled = t.cancelled;
    if (!t.drained) throw coded("TRANSFERS_STILL_RUNNING", `still running: ${t.remaining.join(", ")}`);

    // ── uploads — chunked sessions and their temp files ──
    stage = "uploads";
    const tmpObjIds = (await UploadSession.find({ projectId: project._id }).select("tmpObjId").lean()).map((s) => s.tmpObjId);
    const u = await closeProjectUploads(project._id);
    Object.assign(counts, { uploadsClosed: u.closed, chunksAborted: u.chunksAborted, tempFilesRemoved: u.tempFiles, tempBytesRemoved: u.tempBytes });

    // ── files — the bytes behind every file record, wherever they are ──
    stage = "files";
    const rows = await FileObject.find({ projectId: project._id }).select("storageKey status sizeBytes").lean();
    const f = { activeFiles: 0, activeBytes: 0, trashedFiles: 0, trashedBytes: 0, purgedRecords: 0, physicalRemoved: 0, physicalAlreadyMissing: 0 };
    await pool(rows, FILE_CONCURRENCY, async (r) => {
      if (r.status === "active") {
        f.activeFiles++;
        f.activeBytes += r.sizeBytes || 0;
      } else if (r.status === "trashed") {
        f.trashedFiles++;
        f.trashedBytes += r.sizeBytes || 0;
      } else f.purgedRecords++;
      // Look in both places: a trashed record whose move failed left its bytes in data/.
      const inData = await provider.stat(r.storageKey);
      const inTrash = await provider.statTrash(r.storageKey);
      if (inData) await provider.remove(r.storageKey); // throws unless removed
      if (inTrash) await provider.removeFromTrash(r.storageKey);
      if (inData || inTrash) f.physicalRemoved += (inData ? 1 : 0) + (inTrash ? 1 : 0);
      else if (r.status !== "purged") f.physicalAlreadyMissing++;
    });
    Object.assign(counts, f);

    // ── storage — whatever is still in the project's directories ──
    stage = "storage";
    const stray = await provider.removeProjectStorage(id);
    counts.strayFilesRemoved = stray.data.files + stray.trash.files;
    counts.strayBytesRemoved = stray.data.bytes + stray.trash.bytes;

    // ── records — sessions, file records, keys, usage, request logs ──
    stage = "records";
    keyIds = await ApiKey.find({ projectId: project._id }).distinct("_id");
    await deleteRecords(project._id, keyIds, counts);

    // ── verify — sweep again, then nothing of the project may be left ──
    stage = "verify";
    await sleep(SETTLE_MS);
    await deleteRecords(project._id, keyIds, counts);
    await provider.removeProjectStorage(id);
    const left = await leftovers(project, keyIds, tmpObjIds);
    if (left.length) throw coded("DATA_REMAINS", `left: ${left.join(", ")}`);

    // ── project — the record itself, last ──
    stage = "project";
    await Project.deleteOne({ _id: project._id });

    counts.durationMs = Date.now() - t0;
    let audited = true;
    try {
      await AuditLog.create({
        ts: new Date(),
        actorUserId: user?._id || null,
        actorLabel: user?.email || "",
        action: "project.permanently_deleted",
        targetType: "project",
        targetId: id,
        projectId: project._id,
        details: {
          projectId: id,
          name: project.name,
          ownerId: String(project.ownerId),
          previousStatus: marked.deletion?.previousStatus || null,
          attempts: marked.deletion?.attempts || 1,
          requestId,
          counts,
        },
        ip: ip || "",
      });
    } catch (e) {
      audited = false; // the deletion itself is complete — report it, don't undo it
      logError("project.delete.audit", { projectId: id, requestId }, e);
    }
    return { ok: true, counts, audited };
  } catch (e) {
    const errorCode = typeof e?.code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(e.code) ? e.code : "ERROR";
    await Project.updateOne(
      { _id: project._id },
      { $set: { "deletion.stage": stage, "deletion.lastErrorCode": errorCode, "deletion.lastErrorAt": new Date() } },
    ).catch(() => {});
    logError("project.delete", { projectId: id, stage, requestId }, e);
    recordAudit({
      user,
      action: "project.delete_failed",
      targetType: "project",
      targetId: id,
      projectId: project._id,
      details: { name: project.name, stage, errorCode, requestId },
      ip,
    });
    return { ok: false, code: "PROJECT_DELETE_FAILED", stage, errorCode };
  } finally {
    running.delete(id);
  }
}
