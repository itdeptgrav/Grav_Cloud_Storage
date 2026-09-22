// lib/services/fileService.js
// File lookups + list, always scoped to a project (the isolation boundary).

import { connectDB } from "@/lib/db/mongoose";
import FileObject from "@/lib/db/models/FileObject";
import config from "@/lib/config";

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

/** Paginated, project-scoped, active-only listing. */
export async function listFiles(project, params) {
  await connectDB();
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  let limit = parseInt(params.limit || "20", 10) || 20;
  limit = Math.min(Math.max(1, limit), config.maxListLimit);

  const q = { projectId: project._id, status: "active" };

  const search = (params.search || "").trim();
  if (search) q.originalName = { $regex: escapeRegex(search), $options: "i" };

  const folder = (params.folder || "").trim();
  if (folder) q.folderPath = folder.split("/").filter(Boolean);

  const type = (params.type || "").trim();
  if (type) q.mimeType = { $regex: "^" + escapeRegex(type) };

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
