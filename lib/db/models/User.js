// lib/db/models/User.js
// A Grav Storage account. Roles: superadmin (sees the whole platform) or user
// (sees only their own projects). Passwords are stored ONLY as a bcrypt hash.

import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // bcrypt hash — never the plaintext password.
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["superadmin", "user"], default: "user", index: true },
    status: { type: String, enum: ["active", "disabled"], default: "active" },
    // Set on bootstrap-seeded admins so the UI can nudge a password change.
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "users" },
);

/** Client-safe projection. NEVER includes passwordHash. */
userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: String(this._id),
    name: this.name,
    email: this.email,
    role: this.role,
    status: this.status,
    mustChangePassword: this.mustChangePassword,
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt,
  };
};

export default mongoose.models.User || mongoose.model("User", userSchema);
