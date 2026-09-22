// lib/services/usageService.js
// Atomic ($inc) counter updates. All BEST-EFFORT and fire-and-forget: a
// telemetry write must never fail or slow a file operation (plan §21/§25).
//
// Distinctions kept separate (plan §13/§18/§26):
//   currentStorageBytes — active bytes; DECREMENTS on trash.
//   counters.bytesUp    — historical uploaded bandwidth; never decrements.
//   counters.bytesDown  — historical served bandwidth; ACTUAL bytes served.

import Project from "@/lib/db/models/Project";
import ApiKey from "@/lib/db/models/ApiKey";
import FileObject from "@/lib/db/models/FileObject";

export function recordUpload(project, key, bytes) {
  Project.updateOne(
    { _id: project._id },
    { $inc: { currentStorageBytes: bytes, fileCount: 1, "counters.uploads": 1, "counters.bytesUp": bytes } },
  ).catch(() => {});
  ApiKey.updateOne({ _id: key._id }, { $inc: { "counters.uploads": 1, "counters.bytesUp": bytes } }).catch(() => {});
}

export function recordDownload(project, key, fileObjectId, bytesServed) {
  const bytes = Math.max(0, bytesServed || 0);
  Project.updateOne({ _id: project._id }, { $inc: { "counters.downloads": 1, "counters.bytesDown": bytes } }).catch(() => {});
  ApiKey.updateOne({ _id: key._id }, { $inc: { "counters.downloads": 1, "counters.bytesDown": bytes } }).catch(() => {});
  if (fileObjectId && bytes > 0) {
    FileObject.updateOne({ _id: fileObjectId }, { $inc: { downloads: 1, bytesServed: bytes } }).catch(() => {});
  }
}

export function recordTrash(project, bytes) {
  Project.updateOne(
    { _id: project._id },
    { $inc: { currentStorageBytes: -Math.max(0, bytes || 0), fileCount: -1 } },
  ).catch(() => {});
}

export function recordError(project, key) {
  if (project) Project.updateOne({ _id: project._id }, { $inc: { "counters.errors": 1 } }).catch(() => {});
  if (key) ApiKey.updateOne({ _id: key._id }, { $inc: { "counters.errors": 1 } }).catch(() => {});
}
