// /api/projects/:id/permanent — PERMANENT project deletion (dashboard session only)
//   GET    → what a deletion would remove (real counts) — for the confirmation dialog
//   DELETE → delete the project and everything it owns. JSON body:
//              { "confirmName": "<the exact project name>", "acknowledge": true }
//            Also the RETRY of a deletion that failed part-way (project "deleting").
// Owner or super-admin only; anyone else gets 404, as on every project route. The
// session cookie is the only credential this route reads — an API key cannot
// reach it. The work itself is lib/services/projectDeletion.js.
import { ok, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth/guards";
import { getProjectForUser } from "@/lib/services/projectService";
import { deletionSummary, deleteProjectPermanently } from "@/lib/services/projectDeletion";
import { withLog, setLogCtx, ipOf } from "@/lib/apiLog";
import { csrfGuard } from "@/lib/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Never tagged with the project id: the deletion removes the project's request
// logs, and this request's own log line must not outlive it as project data.
async function load(request, params) {
  const { user, error } = await requireUser();
  if (error) {
    setLogCtx(request, { actorType: "dashboard", errorCode: "UNAUTHENTICATED" });
    return { error };
  }
  setLogCtx(request, { actorType: "dashboard", userId: user._id, actorLabel: user.email });
  const { id } = await params;
  const { project, notFound } = await getProjectForUser(user, id);
  if (notFound) {
    setLogCtx(request, { errorCode: "NOT_FOUND" });
    return { error: fail("NOT_FOUND", "Project not found.") };
  }
  return { user, project };
}

export const GET = withLog("project.delete_preview", async (request, { params }) => {
  const { project, error } = await load(request, params);
  if (error) return error;
  const counts = await deletionSummary(project);
  return ok({
    project: { id: String(project._id), name: project.name, status: project.status, deletion: project.toNode().deletion },
    counts,
  });
});

const STAGE_TEXT = {
  start: "starting the deletion",
  fence: "waiting for writes in progress to finish",
  transfers: "stopping downloads and uploads in progress",
  uploads: "removing unfinished uploads",
  files: "deleting stored files",
  storage: "removing the project's storage folders",
  records: "deleting the project's records",
  verify: "verifying that nothing is left",
  project: "removing the project record",
};

export const DELETE = withLog("project.delete_permanent", async (request, { params }) => {
  const csrf = csrfGuard(request);
  if (csrf) {
    setLogCtx(request, { actorType: "dashboard", errorCode: "CSRF_FAILED" });
    return csrf;
  }
  const { user, project, error } = await load(request, params);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_ERROR", "Invalid JSON body.");
  }
  // The second verification, enforced here too: the exact name (case-sensitive,
  // nothing trimmed) and the explicit acknowledgement.
  if (typeof body?.confirmName !== "string" || body.confirmName !== project.name) {
    setLogCtx(request, { errorCode: "CONFIRMATION_MISMATCH" });
    return fail("CONFIRMATION_MISMATCH", "The project name you typed does not match. Type it exactly to confirm.");
  }
  if (body.acknowledge !== true) {
    setLogCtx(request, { errorCode: "CONFIRMATION_MISMATCH" });
    return fail("CONFIRMATION_MISMATCH", "Confirm that you understand this cannot be undone.");
  }

  const requestId = /^[A-Za-z0-9._:-]{1,100}$/.test(request._requestId || "") ? request._requestId : null;
  const r = await deleteProjectPermanently(project, { user, ip: ipOf(request), requestId });
  if (!r.ok) {
    setLogCtx(request, { errorCode: r.code });
    if (r.code === "PROJECT_DELETE_IN_PROGRESS") {
      return fail(r.code, "This project is already being deleted. Wait for it to finish, then reload.");
    }
    return fail(
      r.code,
      `The deletion stopped while ${STAGE_TEXT[r.stage] || "deleting the project"}. Nothing new can be added to the project; retry the deletion to finish it.`,
      { details: { stage: r.stage, errorCode: r.errorCode } },
    );
  }
  return ok({ deleted: true, projectId: String(project._id), name: project.name, counts: r.counts, audited: r.audited });
});
