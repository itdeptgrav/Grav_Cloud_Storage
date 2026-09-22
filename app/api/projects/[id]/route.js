// /api/projects/:id
//   GET    → one project (owner or super-admin only; else 404)
//   PATCH  → rename / edit description / change status (active|disabled|archived)
//   DELETE → archive (soft) — no hard delete in Phase 1
import { ok, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth/guards";
import { getProjectForUser, updateProject, setProjectStatus } from "@/lib/services/projectService";
import { recordAudit } from "@/lib/services/auditService";
import { ipOf } from "@/lib/apiLog";
import { csrfGuard } from "@/lib/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function load(request, params) {
  const { user, error } = await requireUser();
  if (error) return { error };
  const { id } = await params;
  const { project, notFound } = await getProjectForUser(user, id);
  if (notFound) return { error: fail("NOT_FOUND", "Project not found.") };
  return { user, project };
}

export async function GET(request, { params }) {
  const { project, error } = await load(request, params);
  if (error) return error;
  return ok({ project: project.toNode() });
}

export async function PATCH(request, { params }) {
  const csrf = csrfGuard(request);
  if (csrf) return csrf;
  const { user, project, error } = await load(request, params);
  if (error) return error;

  let body = {};
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_ERROR", "Invalid JSON body.");
  }

  try {
    // Quota is SUPER-ADMIN ONLY — a normal user cannot grant themselves storage.
    if (body.quotaBytes !== undefined) {
      if (user.role !== "superadmin") return fail("FORBIDDEN", "Only a super-admin can change a project's quota.");
      let q = body.quotaBytes;
      if (q === null || q === "" || q === 0) q = null; // unlimited
      else {
        q = Number(q);
        if (!Number.isFinite(q) || q < 0) return fail("VALIDATION_ERROR", "quotaBytes must be a non-negative number or null.");
      }
      const prev = project.quotaBytes;
      project.quotaBytes = q;
      await project.save();
      recordAudit({ user, action: "quota.change", targetType: "project", targetId: String(project._id), projectId: project._id, details: { from: prev, to: q }, ip: ipOf(request) });
    }
    if (body.status !== undefined) {
      await setProjectStatus(project, body.status);
      recordAudit({ user, action: `project.${body.status}`, targetType: "project", targetId: String(project._id), projectId: project._id, ip: ipOf(request) });
    }
    if (body.name !== undefined || body.description !== undefined) {
      if (body.name !== undefined && !String(body.name).trim()) {
        return fail("VALIDATION_ERROR", "Project name cannot be empty.");
      }
      await updateProject(project, { name: body.name, description: body.description });
    }
  } catch (e) {
    return fail(e.code || "VALIDATION_ERROR", e.message || "Could not update the project.");
  }
  return ok({ project: project.toNode() });
}

export async function DELETE(request, { params }) {
  const csrf = csrfGuard(request);
  if (csrf) return csrf;
  const { project, error } = await load(request, params);
  if (error) return error;
  await setProjectStatus(project, "archived");
  return ok({ project: project.toNode() });
}
