// lib/services/logService.js
// Best-effort request logging + daily rollups. Everything here is fire-and-forget
// (never awaited on the hot path) so a log/analytics failure can NEVER break a
// valid upload/download (plan §28/§29).
import mongoose from "mongoose";
import RequestLog from "@/lib/db/models/RequestLog";
import UsageDaily from "@/lib/db/models/UsageDaily";
import { connectDB } from "@/lib/db/mongoose";
import { isProjectRetired } from "@/lib/projectGuard";

const toId = (v) => (mongoose.Types.ObjectId.isValid(String(v || "")) ? new mongoose.Types.ObjectId(String(v)) : null);

const READ_OPS = new Set(["get", "download", "raw"]);

function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Record one request: a detailed RequestLog row (TTL-expired later) + $inc into
 * the durable usage_daily rollups. Deltas are derived from operation/status so
 * the rollup never has to scan the log collection.
 */
export function recordRequest(entry) {
  let e = entry || {};
  // A request that ends after its project was (or is being) permanently deleted
  // is still logged, but not as that project's — it must not bring back request
  // logs or usage rollups the deletion has just removed.
  if (isProjectRetired(e.projectId)) e = { ...e, projectId: null, apiKeyId: null };
  const status = Number(e.status || 0);
  const ok = status >= 200 && status < 400;
  const isUpload = e.operation === "upload" && status >= 200 && status < 300;
  const isDownload = READ_OPS.has(e.operation) && ok && status !== 304;

  // 1) detailed log (TTL)
  RequestLog.create({
    ts: new Date(),
    requestId: e.requestId || "",
    actorType: e.actorType || "anon",
    projectId: e.projectId || null,
    apiKeyId: e.apiKeyId || null,
    keyPrefix: e.keyPrefix || "",
    userId: e.userId || null,
    actorLabel: e.actorLabel || "",
    method: e.method || "",
    operation: e.operation || "",
    fileId: e.fileId || null,
    status,
    durationMs: Math.round(e.durationMs || 0),
    bytesIn: e.bytesIn || 0,
    bytesOut: e.bytesOut || 0,
    errorCode: e.errorCode || null,
    ip: e.ip || "",
  }).catch(() => {});

  // 2) durable daily rollups
  if (!e.projectId) return;
  const date = utcDate();
  const origin = e.actorType === "dashboard" ? "dashboard" : "api";
  const inc = {
    requests: 1,
    errors: status >= 400 ? 1 : 0,
    uploads: isUpload ? 1 : 0,
    downloads: isDownload ? 1 : 0,
    bytesUp: isUpload ? e.bytesIn || 0 : 0,
    bytesDown: isDownload ? e.bytesOut || 0 : 0,
  };
  UsageDaily.updateOne(
    { scope: "project", refId: e.projectId, date, origin },
    { $inc: inc, $setOnInsert: { projectId: e.projectId } },
    { upsert: true },
  ).catch(() => {});
  if (e.apiKeyId) {
    UsageDaily.updateOne(
      { scope: "key", refId: e.apiKeyId, date, origin: "api" },
      { $inc: inc, $setOnInsert: { projectId: e.projectId } },
      { upsert: true },
    ).catch(() => {});
  }
}

/**
 * Query request logs. If `projectId` is provided (dashboard) the query is scoped
 * to it. If null (super-admin global), an optional params.projectId narrows it.
 */
export async function listRequestLogs(projectId, params = {}) {
  await connectDB();
  const q = {};
  if (projectId) q.projectId = projectId;
  else if (params.projectId) {
    const pid = toId(params.projectId);
    if (pid) q.projectId = pid;
  }
  if (params.apiKeyId) {
    const kid = toId(params.apiKeyId);
    if (kid) q.apiKeyId = kid;
  }
  if (params.method) q.method = String(params.method).toUpperCase();
  if (params.status) q.status = Number(params.status);
  if (params.errors === "1" || params.errors === true) q.status = { $gte: 400 };
  if (params.fileId) q.fileId = String(params.fileId);
  if (params.from || params.to) {
    q.ts = {};
    if (params.from) q.ts.$gte = new Date(params.from);
    if (params.to) q.ts.$lte = new Date(params.to);
  }
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(params.limit || "50", 10) || 50), 200);
  const [rows, total] = await Promise.all([
    RequestLog.find(q).sort({ ts: -1 }).skip((page - 1) * limit).limit(limit),
    RequestLog.countDocuments(q),
  ]);
  return {
    logs: rows.map((r) => ({
      id: String(r._id),
      ts: r.ts,
      projectId: r.projectId ? String(r.projectId) : null,
      actorType: r.actorType,
      actor: r.actorLabel || r.keyPrefix || (r.userId ? "user" : "anon"),
      method: r.method,
      operation: r.operation,
      fileId: r.fileId,
      status: r.status,
      durationMs: r.durationMs,
      bytesIn: r.bytesIn,
      bytesOut: r.bytesOut,
      errorCode: r.errorCode,
      ip: r.ip,
    })),
    page,
    limit,
    total,
    hasMore: page * limit < total,
  };
}

/** Daily time-series for the analytics UI, project-scoped, over `days`. */
export async function projectAnalytics(projectId, days = 7) {
  await connectDB();
  const since = new Date(Date.now() - days * 86400 * 1000);
  const sinceStr = since.toISOString().slice(0, 10);
  const rows = await UsageDaily.aggregate([
    { $match: { scope: "project", projectId, date: { $gte: sinceStr } } },
    {
      $group: {
        _id: "$date",
        requests: { $sum: "$requests" },
        errors: { $sum: "$errors" },
        uploads: { $sum: "$uploads" },
        downloads: { $sum: "$downloads" },
        bytesUp: { $sum: "$bytesUp" },
        bytesDown: { $sum: "$bytesDown" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const series = rows.map((r) => ({ date: r._id, requests: r.requests, errors: r.errors, uploads: r.uploads, downloads: r.downloads, bytesUp: r.bytesUp, bytesDown: r.bytesDown }));
  const totals = series.reduce(
    (a, d) => { a.requests += d.requests; a.errors += d.errors; a.uploads += d.uploads; a.downloads += d.downloads; a.bytesUp += d.bytesUp; a.bytesDown += d.bytesDown; return a; },
    { requests: 0, errors: 0, uploads: 0, downloads: 0, bytesUp: 0, bytesDown: 0 },
  );
  totals.errorRate = totals.requests ? totals.errors / totals.requests : 0;
  return { days, series, totals };
}
