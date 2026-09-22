// lib/dashboardAuth.js
// Helper for the SESSION (human) dashboard file plane. Resolves the logged-in
// user AND the target project with ownership enforced — a normal user only
// reaches their own projects (cross-user → 404), a super-admin reaches all.
// This is the isolation boundary for every /api/dashboard file endpoint.
import { requireUser } from "@/lib/auth/guards";
import { getProjectForUser } from "@/lib/services/projectService";
import { fail } from "@/lib/http";

export async function requireProject(id) {
  const { user, error } = await requireUser();
  if (error) return { error };
  const { project, notFound } = await getProjectForUser(user, id);
  if (notFound) return { error: fail("NOT_FOUND", "Project not found.") };
  return { user, project };
}
