// lib/db/models/AuditLog.js
// Important administrative actions. Never stores secrets — only safe descriptors.
import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    ts: { type: Date, default: Date.now },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorLabel: { type: String, default: "" },
    action: { type: String, required: true }, // e.g. "quota.change", "key.revoke"
    targetType: { type: String, default: "" }, // project | apiKey | file | system
    targetId: { type: String, default: "" },
    projectId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} }, // safe fields only
    ip: { type: String, default: "" },
  },
  { collection: "audit_logs" },
);
auditLogSchema.index({ ts: -1 });

export default mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);
