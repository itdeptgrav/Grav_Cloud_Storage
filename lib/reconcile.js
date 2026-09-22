// lib/reconcile.js
// Usage reconciliation (plan §21/§22).
//
// RECONSTRUCTABLE (authoritative from file_objects): currentStorageBytes,
// fileCount — recomputed exactly from active files.
// NOT reconstructable once raw logs expire: historical counters (requests,
// bytesDown, downloads, …). Those are accumulated and are NOT rewritten here.
import FileObject from "@/lib/db/models/FileObject";
import Project from "@/lib/db/models/Project";
import { connectDB } from "@/lib/db/mongoose";

export async function reconcileProject(projectId) {
  await connectDB();
  const agg = await FileObject.aggregate([
    { $match: { projectId, status: "active" } },
    { $group: { _id: null, bytes: { $sum: "$sizeBytes" }, count: { $sum: 1 } } },
  ]);
  const expected = { currentStorageBytes: agg[0]?.bytes || 0, fileCount: agg[0]?.count || 0 };
  const p = await Project.findById(projectId).select("name currentStorageBytes fileCount");
  if (!p) return null;
  const recorded = { currentStorageBytes: p.currentStorageBytes, fileCount: p.fileCount };
  return {
    projectId: String(projectId),
    name: p.name,
    expected,
    recorded,
    diff: {
      currentStorageBytes: recorded.currentStorageBytes - expected.currentStorageBytes,
      fileCount: recorded.fileCount - expected.fileCount,
    },
    inSync: recorded.currentStorageBytes === expected.currentStorageBytes && recorded.fileCount === expected.fileCount,
  };
}

export async function reconcileAll() {
  await connectDB();
  const projects = await Project.find({}).select("_id");
  const out = [];
  for (const p of projects) {
    const r = await reconcileProject(p._id);
    if (r) out.push(r);
  }
  return out;
}

/** Explicit repair — rewrites the reconstructable counters to match reality. */
export async function applyReconcile(projectId) {
  const r = await reconcileProject(projectId);
  if (!r) return null;
  await Project.updateOne(
    { _id: projectId },
    { $set: { currentStorageBytes: r.expected.currentStorageBytes, fileCount: r.expected.fileCount } },
  );
  return { ...r, applied: true };
}
