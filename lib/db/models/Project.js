// lib/db/models/Project.js
// A project owned by exactly one user. Isolation boundary for files, API keys,
// usage and logs. Counters here are authoritative "current" values maintained
// by atomic $inc in later phases (see the plan §18).

import mongoose from "mongoose";

const projectSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, default: "" },
    description: { type: String, default: "", maxlength: 500 },
    // "deleting" = a PERMANENT deletion has started (lib/services/projectDeletion.js).
    // It is one-way: the project refuses everything but a retry of the deletion,
    // and the record is removed as the deletion's last step.
    status: { type: String, enum: ["active", "disabled", "archived", "deleting"], default: "active", index: true },

    // null = unlimited. Enforced on upload in Phase 4.
    quotaBytes: { type: Number, default: null },

    // "Current storage" = active bytes; decreases when files are deleted.
    currentStorageBytes: { type: Number, default: 0 },
    fileCount: { type: Number, default: 0 },

    // Historical, never-decreasing tallies (bandwidth/activity). Distinct from
    // currentStorageBytes on purpose (plan §13/§18).
    counters: {
      uploads: { type: Number, default: 0 },
      downloads: { type: Number, default: 0 },
      bytesUp: { type: Number, default: 0 },
      bytesDown: { type: Number, default: 0 },
      requests: { type: Number, default: 0 },
      errors: { type: Number, default: 0 },
    },

    // Progress of a permanent deletion, so a failed one can be seen and retried.
    // Codes and stage names only — never a path or an error message.
    deletion: {
      startedAt: { type: Date, default: null },
      byUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      previousStatus: { type: String, default: null },
      attempts: { type: Number, default: 0 },
      stage: { type: String, default: null },
      lastErrorCode: { type: String, default: null },
      lastErrorAt: { type: Date, default: null },
    },
  },
  { timestamps: true, collection: "projects" },
);

projectSchema.methods.toNode = function toNode() {
  return {
    id: String(this._id),
    ownerId: String(this.ownerId),
    name: this.name,
    slug: this.slug,
    description: this.description,
    status: this.status,
    quotaBytes: this.quotaBytes,
    currentStorageBytes: this.currentStorageBytes,
    fileCount: this.fileCount,
    counters: this.counters,
    deletion:
      this.status === "deleting" && this.deletion
        ? { startedAt: this.deletion.startedAt, attempts: this.deletion.attempts, stage: this.deletion.stage, lastErrorCode: this.deletion.lastErrorCode, lastErrorAt: this.deletion.lastErrorAt }
        : null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export default mongoose.models.Project || mongoose.model("Project", projectSchema);
