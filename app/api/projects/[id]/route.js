// /api/projects/:id
//   GET    → one project (owner or super-admin only; else 404)
//   PATCH  → rename / edit description / change status (active|disabled|archived)
//   DELETE → archive (soft) — no hard delete in Phase 1
import { ok, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth/guards";
import { getProjectForUser, updateProject, setProjectStatus } from "@/lib/services/projectService";

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
  const { project, error } = await load(request, params);
  if (error) return error;

  let body = {};
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_ERROR", "Invalid JSON body.");
  }

  try {
    if (body.status !== undefined) await setProjectStatus(project, body.status);
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
  const { project, error } = await load(request, params);
  if (error) return error;
  await setProjectStatus(project, "archived");
  return ok({ project: project.toNode() });
}
