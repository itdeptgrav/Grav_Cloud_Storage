// lib/dashboardAuth.js
// Helper for the SESSION (human) dashboard plane. Resolves the logged-in user
// AND the target project with ownership enforced (cross-user → 404; super-admin
// → all). Also populates the request log context for the withLog wrapper.
import { requireUser } from "@/lib/auth/guards";
import { getProjectForUser } from "@/lib/services/projectService";
import { fail } from "@/lib/http";
import { setLogCtx } from "@/lib/apiLog";

export async function requireProject(request, id) {
  const { user, error } = await requireUser();
  if (error) {
    if (request) setLogCtx(request, { actorType: "dashboard", errorCode: "UNAUTHENTICATED" });
    return { error };
  }
  const { project, notFound } = await getProjectForUser(user, id);
  if (notFound) {
    if (request) setLogCtx(request, { actorType: "dashboard", userId: user._id, actorLabel: user.email, errorCode: "NOT_FOUND" });
    return { error: fail("NOT_FOUND", "Project not found.") };
  }
  if (request) setLogCtx(request, { actorType: "dashboard", userId: user._id, actorLabel: user.email, projectId: project._id });
  return { user, project };
}
