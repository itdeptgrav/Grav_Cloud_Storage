// lib/projectGuard.js
// What keeps a project that is being PERMANENTLY DELETED from gaining anything
// new while its storage is torn down (lib/services/projectDeletion.js).
//
//   write fence   — every step that CREATES something a project owns (commit a
//                   file, start a chunked upload, move bytes data⇄trash, mint an
//                   API key) runs inside withProjectWrite(). It holds a lease and
//                   re-reads the project's status from MongoDB; a project that is
//                   "deleting" (or gone) refuses. The deletion first sets
//                   "deleting", then waits for the leases already held to finish
//                   (drainProjectWrites), so nothing can be committed behind its back.
//   transfers     — streams that are moving bytes right now (downloads, single-
//                   request uploads) register a cancel function; the deletion
//                   cancels them and waits until every one has cleaned up.
//   retired set   — ids of projects this process is deleting / has deleted. A
//                   request that finishes afterwards must not re-create usage
//                   rollups or request-log rows for the project (logService).
//
// Process memory, on globalThis (survives a dev hot-reload of this module) —
// the same single-process assumption as lib/limits and lib/chunkedUploads.
import Project from "@/lib/db/models/Project";
import { connectDB } from "@/lib/db/mongoose";

const g =
  globalThis.__gsProjectGuard ||
  (globalThis.__gsProjectGuard = { writes: new Map(), transfers: new Map(), retired: new Set() });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const PROJECT_DELETING_MESSAGE = "This project is being permanently deleted.";

/**
 * Run `fn` only if the project can still take writes. Returns
 * { fenced: true } when it is being deleted (or no longer exists), else
 * { fenced: false, value }.
 */
export async function withProjectWrite(projectId, fn) {
  const id = String(projectId);
  g.writes.set(id, (g.writes.get(id) || 0) + 1);
  try {
    if (g.retired.has(id)) return { fenced: true };
    await connectDB();
    const p = await Project.findById(projectId).select("status").lean();
    if (!p || p.status === "deleting") return { fenced: true };
    return { fenced: false, value: await fn() };
  } finally {
    const n = (g.writes.get(id) || 1) - 1;
    if (n <= 0) g.writes.delete(id);
    else g.writes.set(id, n);
  }
}

/** Wait until no write lease is held for the project. false = timed out. */
export async function drainProjectWrites(projectId, timeoutMs) {
  const id = String(projectId);
  const until = Date.now() + timeoutMs;
  while ((g.writes.get(id) || 0) > 0) {
    if (Date.now() >= until) return false;
    await sleep(25);
  }
  return true;
}

/**
 * Register a transfer that is moving bytes for a project. `cancel()` must make
 * it stop and clean up after itself; the returned function unregisters it and
 * must be called once it has (on every exit path). Returns null — and registers
 * nothing — when the project is already being deleted: the caller refuses.
 */
export function trackTransfer(projectId, cancel, kind = "transfer") {
  const id = String(projectId);
  if (g.retired.has(id)) return null;
  let set = g.transfers.get(id);
  if (!set) g.transfers.set(id, (set = new Set()));
  const entry = { cancel, kind };
  set.add(entry);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    set.delete(entry);
    if (!set.size && g.transfers.get(id) === set) g.transfers.delete(id);
  };
}

/** Cancel every registered transfer of the project and wait until all unregistered. */
export async function cancelProjectTransfers(projectId, timeoutMs) {
  const id = String(projectId);
  const set = g.transfers.get(id);
  let cancelled = 0;
  for (const entry of set ? [...set] : []) {
    try {
      entry.cancel();
      cancelled++;
    } catch {
      /* it is already stopping */
    }
  }
  const until = Date.now() + timeoutMs;
  while ((g.transfers.get(id)?.size || 0) > 0) {
    if (Date.now() >= until) return { cancelled, drained: false, remaining: [...g.transfers.get(id)].map((e) => e.kind) };
    await sleep(25);
  }
  return { cancelled, drained: true, remaining: [] };
}

export function retireProject(projectId) {
  g.retired.add(String(projectId));
}

export function isProjectRetired(projectId) {
  return projectId != null && g.retired.has(String(projectId));
}
