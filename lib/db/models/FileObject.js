// lib/db/models/FileObject.js
// Metadata for ONE stored object. Binary bytes live on disk (see the storage
// provider); this row never holds file contents.
//
// `storageKey` is the on-disk location relative to the data dir. It is
// server-generated and PRIVATE — toMeta() never returns it, and no API response
// exposes a physical path.

import mongoose from "mongoose";

const FILE_STATUS = ["active", "trashed", "purged"];

const fileObjectSchema = new mongoose.Schema(
  {
    // Opaque public id (file_...). The public storage contract — never _id.
    fileId: { type: String, required: true, unique: true },

    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    uploadedByApiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: "ApiKey", default: null },

    originalName: { type: String, required: true, maxlength: 400 },
    // Private: where the bytes are on disk, relative to the data dir.
    storageKey: { type: String, required: true },

    mimeType: { type: String, default: "application/octet-stream" },
    extension: { type: String, default: "" },
    sizeBytes: { type: Number, default: 0 },

    checksumSha256: { type: String, default: "" },

    storageProvider: { type: String, default: "local" },
    status: { type: String, enum: FILE_STATUS, default: "active", index: true },

    // Logical organisation (NOT a physical path).
    folderPath: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Served-bandwidth counters for this object.
    downloads: { type: Number, default: 0 },
    bytesServed: { type: Number, default: 0 },

    trashedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "file_objects" },
);

// Indexes (per the plan): fast per-project listing by recency + status.
fileObjectSchema.index({ projectId: 1, status: 1, createdAt: -1 });
fileObjectSchema.index({ projectId: 1, status: 1, originalName: 1 });

/** Client-safe metadata. NO storageKey, NO physical path. */
fileObjectSchema.methods.toMeta = function toMeta() {
  return {
    fileId: this.fileId,
    name: this.originalName,
    mimeType: this.mimeType,
    extension: this.extension,
    sizeBytes: this.sizeBytes,
    checksumSha256: this.checksumSha256,
    status: this.status,
    folderPath: this.folderPath,
    tags: this.tags,
    metadata: this.metadata,
    downloads: this.downloads,
    bytesServed: this.bytesServed,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    trashedAt: this.trashedAt,
  };
};

export const FILE_STATUSES = FILE_STATUS;
export default mongoose.models.FileObject || mongoose.model("FileObject", fileObjectSchema);
