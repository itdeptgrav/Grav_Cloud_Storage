// lib/db/models/UsageDaily.js
// Long-term daily aggregates that SURVIVE request-log TTL expiry. Updated by an
// efficient upsert+$inc per request (never a scan of request_logs).
// One document per (scope, refId, date, origin):
//   scope  = "project" | "key"
//   refId  = projectId  | apiKeyId
//   origin = "api" | "dashboard"   (dashboard activity is not faked as a key)
import mongoose from "mongoose";

const usageDailySchema = new mongoose.Schema(
  {
    scope: { type: String, enum: ["project", "key"], required: true },
    refId: { type: mongoose.Schema.Types.ObjectId, required: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, index: true }, // for global/project queries
    date: { type: String, required: true }, // YYYY-MM-DD (UTC)
    origin: { type: String, enum: ["api", "dashboard"], default: "api" },
    requests: { type: Number, default: 0 },
    errors: { type: Number, default: 0 },
    uploads: { type: Number, default: 0 },
    downloads: { type: Number, default: 0 },
    bytesUp: { type: Number, default: 0 },
    bytesDown: { type: Number, default: 0 },
  },
  { collection: "usage_daily", suppressReservedKeysWarning: true },
);

usageDailySchema.index({ scope: 1, refId: 1, date: 1, origin: 1 }, { unique: true });
usageDailySchema.index({ projectId: 1, date: 1 });

export default mongoose.models.UsageDaily || mongoose.model("UsageDaily", usageDailySchema);
