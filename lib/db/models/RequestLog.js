// lib/db/models/RequestLog.js
// Detailed per-request log. Expires via a TTL index (LOG_RETENTION_DAYS) so raw
// logs never grow forever; long-term totals live in usage_daily instead.
// NEVER stores secrets: no full API key, Authorization header, password, JWT,
// cookie, or physical path — only a safe key prefix/label.
import mongoose from "mongoose";
import config from "@/lib/config";

const requestLogSchema = new mongoose.Schema(
  {
    ts: { type: Date, default: Date.now },
    actorType: { type: String, enum: ["api", "dashboard", "anon"], default: "anon" },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", default: null, index: true },
    apiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: "ApiKey", default: null },
    keyPrefix: { type: String, default: "" }, // safe display, never the secret
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorLabel: { type: String, default: "" },
    method: { type: String, default: "" },
    operation: { type: String, default: "" },
    fileId: { type: String, default: null },
    status: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    bytesIn: { type: Number, default: 0 },
    bytesOut: { type: Number, default: 0 },
    errorCode: { type: String, default: null },
    ip: { type: String, default: "" },
  },
  { collection: "request_logs" },
);

// TTL: drop detailed logs after retention. expireAfterSeconds is read once at
// index creation; changing LOG_RETENTION_DAYS later needs the index rebuilt.
requestLogSchema.index({ ts: 1 }, { expireAfterSeconds: Math.max(1, config.logRetentionDays) * 86400 });
// Query paths: per-project recent, and filters by key/status.
requestLogSchema.index({ projectId: 1, ts: -1 });
requestLogSchema.index({ projectId: 1, apiKeyId: 1, ts: -1 });

export default mongoose.models.RequestLog || mongoose.model("RequestLog", requestLogSchema);
