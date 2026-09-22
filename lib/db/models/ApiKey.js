// lib/db/models/ApiKey.js
// An API key belonging to a project. The RAW secret is NEVER stored — only a
// SHA-256/HMAC hash of it (see lib/services/apiKeyService.js). The raw key is
// shown exactly once, at creation.
//
// Key string:   gsk_{live|test}_{lookupId}_{secret}
//   lookupId — 12 chars, stored in clear + unique-indexed, for O(1) lookup.
//   secret   — 40 chars, high-entropy; only its hash is persisted.
//   keyPrefix (gsk_{env}_{lookupId}) is the safe, displayable identifier.

import mongoose from "mongoose";

const apiKeySchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    env: { type: String, enum: ["live", "test"], default: "live" },

    lookupId: { type: String, required: true, unique: true },
    keyPrefix: { type: String, required: true }, // gsk_{env}_{lookupId}
    secretHash: { type: String, required: true }, // hash of the full raw key

    scopes: { type: [String], default: [] },
    status: { type: String, enum: ["active", "revoked"], default: "active", index: true },

    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    // Links a rotated key back to the one it replaces (safe rotation, §D).
    rotatedFromId: { type: mongoose.Schema.Types.ObjectId, ref: "ApiKey", default: null },

    counters: {
      requests: { type: Number, default: 0 },
      uploads: { type: Number, default: 0 },
      downloads: { type: Number, default: 0 },
      bytesUp: { type: Number, default: 0 },
      bytesDown: { type: Number, default: 0 },
      errors: { type: Number, default: 0 },
    },
  },
  { timestamps: true, collection: "api_keys" },
);

/** Client-safe view. NEVER includes secretHash. `maskedKey` is display-only. */
apiKeySchema.methods.toNode = function toNode() {
  return {
    id: String(this._id),
    projectId: String(this.projectId),
    name: this.name,
    env: this.env,
    keyPrefix: this.keyPrefix,
    maskedKey: `${this.keyPrefix}${"•".repeat(8)}`,
    scopes: this.scopes,
    status: this.status,
    lastUsedAt: this.lastUsedAt,
    revokedAt: this.revokedAt,
    rotatedFromId: this.rotatedFromId ? String(this.rotatedFromId) : null,
    counters: this.counters,
    createdAt: this.createdAt,
  };
};

export default mongoose.models.ApiKey || mongoose.model("ApiKey", apiKeySchema);
