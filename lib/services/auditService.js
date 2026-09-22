// lib/services/auditService.js
// Record important admin/operational actions. Best-effort. Never stores secrets.
import AuditLog from "@/lib/db/models/AuditLog";

export function recordAudit({ user, action, targetType, targetId, projectId, details, ip }) {
  AuditLog.create({
    ts: new Date(),
    actorUserId: user?._id || null,
    actorLabel: user?.email || user?.name || "",
    action,
    targetType: targetType || "",
    targetId: targetId ? String(targetId) : "",
    projectId: projectId || null,
    details: details || {},
    ip: ip || "",
  }).catch(() => {});
}
