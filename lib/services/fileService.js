// lib/services/fileService.js
// File lookups + list, always scoped to a project (the isolation boundary).

import { connectDB } from "@/lib/db/mongoose";
import FileObject from "@/lib/db/models/FileObject";
import getStorageProvider from "@/lib/storage/provider";
import { recordTrash } from "@/lib/services/usageService";
import { commitStorage, releaseStorage } from "@/lib/services/quotaService";
import config from "@/lib/config";
import { logError } from "@/lib/logSafe";
import { withProjectWrite, PROJECT_DELETING_MESSAGE } from "@/lib/projectGuard";

const FILE_ID_RE = /^file_[A-Za-z0-9]{8,}$/;

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Load one ACTIVE file belonging to this project. Cross-project access returns
 * null (→ 404), never revealing that another project's file exists.
 */
export async function loadActiveFile(project, fileId) {
  if (typeof fileId !== "string" || !FILE_ID_RE.test(fileId)) return null;
  await connectDB();
  return FileObject.findOne({ fileId, projectId: project._id, status: "active" });
}

/** Soft-delete → trash. Shared by the API-key and dashboard delete paths.
 *  DB first (leaves listings/reads immediately), then move bytes data→trash.
 *  Returns null (nothing done) when the project is being permanently deleted. */
export async function trashFile(project, file) {
  const run = await withProjectWrite(project._id, () => trashFileNow(project, file));
  return run.fenced ? null : run.value;
}

async function trashFileNow(project, file) {
  const bytes = file.sizeBytes;
  file.status = "trashed";
  file.trashedAt = new Date();
  await file.save();
  try {
    const moved = await getStorageProvider().moveToTrash(file.storageKey);
    if (!moved) console.warn("[trash] physical object already missing for", file.fileId);
  } catch (e) {
    // The record is trashed but its bytes stayed in data/ (stray until reconciled).
    logError("trash.move", { projectId: project?._id, fileId: file.fileId }, e);
  }
  recordTrash(project, bytes);
  return file;
}

/** Load a trashed file for restore/purge (project-scoped). */
export async function loadTrashedFile(project, fileId) {
  if (typeof fileId !== "string" || !FILE_ID_RE.test(fileId)) return null;
  await connectDB();
  return FileObject.findOne({ fileId, projectId: project._id, status: "trashed" });
}

/**
 * Restore a trashed file → active. Quota-checked (atomic) and all-or-nothing:
 * reserves storage first, then moves bytes back; on any failure it rolls the
 * reservation back and stays trashed. Returns { ok } or { ok:false, code }.
 */
export async function restoreFile(project, file) {
  const run = await withProjectWrite(project._id, () => restoreFileNow(project, file));
  return run.fenced ? { ok: false, code: "PROJECT_DELETING", message: PROJECT_DELETING_MESSAGE } : run.value;
}

async function restoreFileNow(project, file) {
  const provider = getStorageProvider();
  const present = await provider.statTrash(file.storageKey);
  if (!present) return { ok: false, code: "FILE_NOT_FOUND", message: "The trashed file's bytes are missing." };

  // Atomic quota reservation (same gate as upload).
  const reserved = await commitStorage(project._id, file.sizeBytes);
  if (!reserved) return { ok: false, code: "STORAGE_QUOTA_EXCEEDED", message: "Restoring this file would exceed the project quota." };

  const moved = await provider.restoreFromTrash(file.storageKey).catch(() => false);
  if (!moved) {
    await releaseStorage(project._id, file.sizeBytes); // undo reservation
    return { ok: false, code: "FILE_NOT_FOUND", message: "The trashed file's bytes could not be restored." };
  }
  file.status = "active";
  file.trashedAt = null;
  await file.save();
  return { ok: true, file };
}

/** Permanently purge a trashed file: remove bytes, mark purged (row kept).
 *  { ok:false } when the project is being permanently deleted (that removes it). */
export async function purgeFile(file) {
  const run = await withProjectWrite(file.projectId, async () => {
    const provider = getStorageProvider();
    await provider.removeFromTrash(file.storageKey).catch(() => {});
    file.status = "purged";
    await file.save();
    return { ok: true };
  });
  return run.fenced ? { ok: false, code: "PROJECT_DELETING", message: PROJECT_DELETING_MESSAGE } : run.value;
}

function mapSort(sortParam) {
  switch (sortParam) {
    case "createdAt":
      return { createdAt: 1 };
    case "name":
      return { originalName: 1 };
    case "-name":
      return { originalName: -1 };
    case "size":
      return { sizeBytes: 1 };
    case "-size":
      return { sizeBytes: -1 };
    case "-createdAt":
    default:
      return { createdAt: -1 };
  }
}

// Category → mime matcher, for the file-manager filter chips.
const CATEGORY_MIME = {
  images: /^image\//,
  videos: /^video\//,
  audio: /^audio\//,
  documents: /^(application\/pdf|application\/msword|application\/vnd|text\/|application\/rtf|application\/vnd\.oasis)/,
  archives: /^(application\/zip|application\/x-7z|application\/x-rar|application\/x-tar|application\/gzip|application\/x-bzip)/,
};

/** Paginated, project-scoped listing. status defaults to "active"; the Trash
 *  view passes "trashed". Filtering/sorting is server-side. */
export async function listFiles(project, params) {
  await connectDB();
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  let limit = parseInt(params.limit || "20", 10) || 20;
  limit = Math.min(Math.max(1, limit), config.maxListLimit);

  const status = params.status === "trashed" ? "trashed" : "active";
  const q = { projectId: project._id, status };

  const search = (params.search || "").trim();
  if (search) q.originalName = { $regex: escapeRegex(search), $options: "i" };

  const folder = (params.folder || "").trim();
  if (folder) q.folderPath = folder.split("/").filter(Boolean);

  // `type` = a raw mime prefix (e.g. "image/") OR a category (images/videos/…).
  const type = (params.type || "").trim();
  if (type) {
    if (CATEGORY_MIME[type]) q.mimeType = { $regex: CATEGORY_MIME[type] };
    else if (type === "other") q.mimeType = { $not: new RegExp([CATEGORY_MIME.images.source, CATEGORY_MIME.videos.source, CATEGORY_MIME.audio.source, CATEGORY_MIME.documents.source, CATEGORY_MIME.archives.source].join("|")) };
    else q.mimeType = { $regex: "^" + escapeRegex(type) };
  }

  const sort = mapSort(params.sort || "-createdAt");

  const total = await FileObject.countDocuments(q);
  const rows = await FileObject.find(q)
    .sort(sort)
    .skip((page - 1) * limit)
    .limit(limit);

  return {
    files: rows.map((r) => r.toMeta()),
    page,
    limit,
    total,
    hasMore: page * limit < total,
  };
}
