// lib/services/projectService.js
import mongoose from "mongoose";
import { connectDB } from "@/lib/db/mongoose";
import Project from "@/lib/db/models/Project";

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function createProject(user, { name, description }) {
  await connectDB();
  return Project.create({
    ownerId: user._id,
    name: String(name).trim(),
    description: String(description || "").trim(),
    slug: slugify(name),
  });
}

export async function listProjects(user) {
  await connectDB();
  // A normal user sees ONLY their own; a super-admin sees everything.
  const q = user.role === "superadmin" ? {} : { ownerId: user._id };
  return Project.find(q).sort({ createdAt: -1 });
}

/**
 * Load a project the user is allowed to see. Cross-user access returns
 * { notFound:true } (404) rather than 403 — a 403 on a specific id would
 * confirm the project exists in someone else's account (IDOR leak).
 */
export async function getProjectForUser(user, id) {
  await connectDB();
  if (!isId(id)) return { notFound: true };
  const project = await Project.findById(id);
  if (!project) return { notFound: true };
  if (user.role !== "superadmin" && String(project.ownerId) !== String(user._id)) {
    return { notFound: true };
  }
  return { project };
}

export async function updateProject(project, { name, description }) {
  if (name !== undefined) {
    project.name = String(name).trim();
    project.slug = slugify(project.name);
  }
  if (description !== undefined) project.description = String(description || "").trim();
  await project.save();
  return project;
}

export async function setProjectStatus(project, status) {
  if (!["active", "disabled", "archived"].includes(status)) {
    throw Object.assign(new Error("Invalid status."), { code: "VALIDATION_ERROR" });
  }
  // "deleting" is one-way: only the permanent deletion moves a project out of it.
  if (project.status === "deleting") {
    throw Object.assign(new Error("This project is being permanently deleted."), { code: "PROJECT_DELETING" });
  }
  project.status = status;
  await project.save();
  return project;
}
