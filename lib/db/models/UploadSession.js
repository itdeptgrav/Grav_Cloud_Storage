// lib/db/models/UploadSession.js
// A chunked-upload session, PERSISTED so an upload survives a dropped
// connection, a failed chunk, a page refresh and a server restart. MongoDB is the
// source of truth for progress; the bytes live in one private temp file
// (tmp/chunked/<tmpObjId>.part) that is NEVER exposed by the API.
//
// Terminal sessions (completed/aborted/expired/failed) get a purgeAt date and
// MongoDB's own TTL monitor deletes them later — no Node timer involved.

import mongoose from "mongoose";

const STATUS = ["active", "completing", "completed", "aborted", "expired", "failed"];

const uploadSessionSchema = new mongoose.Schema(
  {
    // Public, unguessable handle (up_ + 32 base62 chars ≈ 190 bits).
    uploadId: { type: String, required: true, unique: true },

    // Ownership: a session is bound to its project AND to the exact identity
    // that began it — the dashboard user, or the API key. Nobody else may drive it.
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    plane: { type: String, enum: ["dashboard", "api"], required: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    ownerApiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: "ApiKey", default: null },

    originalName: { type: String, required: true, maxlength: 400 },
    mimeType: { type: String, default: "application/octet-stream" },
    declaredSize: { type: Number, required: true },
    chunkSize: { type: Number, required: true },
    totalChunks: { type: Number, required: true },

    // Progress — advanced only after a chunk is fully written, checksum-verified
    // and fsync'd, with a conditional update on nextIndex.
    nextIndex: { type: Number, default: 0 },
    bytesReceived: { type: Number, default: 0 },
    chunkHashes: { type: [String], default: [] }, // SHA-256 of each accepted chunk, in order

    // Optional full-file SHA-256 declared at begin (API clients); enforced at complete.
    expectedSha256: { type: String, default: null },

    // PRIVATE — identifies the temp file. Never returned by any API.
    tmpObjId: { type: String, required: true },

    status: { type: String, enum: STATUS, default: "active", index: true },
    failureCode: { type: String, default: null },
    fileId: { type: String, default: null }, // set on completion → complete is idempotent
    expiresAt: { type: Date, required: true, index: true }, // sliding idle expiry
    completingAt: { type: Date, default: null },
    purgeAt: { type: Date, default: null }, // TTL — only set on terminal sessions
  },
  { timestamps: true, collection: "upload_sessions" },
);

uploadSessionSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
uploadSessionSchema.index({ projectId: 1, status: 1 });

/** Safe public view — no temp id, no owner ids. */
uploadSessionSchema.methods.toPublic = function toPublic() {
  return {
    uploadId: this.uploadId,
    fileName: this.originalName,
    mimeType: this.mimeType,
    declaredSize: this.declaredSize,
    chunkSize: this.chunkSize,
    totalChunks: this.totalChunks,
    nextIndex: this.nextIndex,
    bytesReceived: this.bytesReceived,
    chunkHashes: this.chunkHashes,
    status: this.status,
    failureCode: this.failureCode,
    fileId: this.fileId,
    expiresAt: this.expiresAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const UPLOAD_SESSION_STATUS = STATUS;
export default mongoose.models.UploadSession || mongoose.model("UploadSession", uploadSessionSchema);
