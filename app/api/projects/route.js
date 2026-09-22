// /api/projects
//   GET  → list projects the caller may see (own; all for super-admin)
//   POST → create a project owned by the caller
import { ok, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth/guards";
import { createProject, listProjects } from "@/lib/services/projectService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, error } = await requireUser();
  if (error) return error;
  const projects = await listProjects(user);
  return ok({ projects: projects.map((p) => p.toNode()) });
}

export async function POST(request) {
  const { user, error } = await requireUser();
  if (error) return error;

  let body = {};
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_ERROR", "Invalid JSON body.");
  }
  const name = String(body.name || "").trim();
  if (!name) return fail("VALIDATION_ERROR", "A project name is required.");
  if (name.length > 120) return fail("VALIDATION_ERROR", "Project name is too long.");

  const project = await createProject(user, { name, description: body.description });
  return ok({ project: project.toNode() }, { status: 201 });
}
