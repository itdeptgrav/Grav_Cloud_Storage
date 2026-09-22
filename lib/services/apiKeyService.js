// lib/services/apiKeyService.js
// API-key generation, hashing, verification, revoke and rotate.
//
// SECURITY MODEL
//   Key string:  gsk_{live|test}_{lookupId}_{secret}
//     lookupId — 12 random chars, stored in clear (unique index) → O(1) lookup.
//     secret   — 40 random chars, high entropy. NEVER stored.
//   Stored:      secretHash = HMAC-SHA256(pepper, rawKey)   (or SHA-256 if no
//                pepper). The raw key is returned to the caller EXACTLY ONCE.
//   Verify:      parse → find by lookupId → constant-time compare of hashes.
//
// Why a fast hash (not bcrypt): the secret is already 40 chars of 62-symbol
// entropy (~238 bits) — brute force is infeasible, and bcrypt would add cost to
// every API request. This is the Stripe/GitHub model.

import crypto from "crypto";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db/mongoose";
import ApiKey from "@/lib/db/models/ApiKey";
import Project from "@/lib/db/models/Project";
import config from "@/lib/config";

export const VALID_SCOPES = ["files:read", "files:write", "files:list", "files:delete"];

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// Rejection-free uniform pick over a 62-char alphabet from random bytes.
function randToken(len) {
  const out = new Array(len);
  const bytes = crypto.randomBytes(len * 2);
  let bi = 0;
  for (let i = 0; i < len; i++) {
    // Reject bytes >= 248 (4*62) to avoid modulo bias; refill if we run out.
    let b = bytes[bi++];
    while (b >= 248) {
      b = bi < bytes.length ? bytes[bi++] : crypto.randomBytes(1)[0];
    }
    out[i] = ALPHABET[b % 62];
  }
  return out.join("");
}

function hashRawKey(rawKey) {
  if (config.keyHashPepper) {
    return crypto.createHmac("sha256", config.keyHashPepper).update(rawKey).digest("hex");
  }
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

const KEY_RE = /^gsk_(live|test)_([A-Za-z0-9]{12})_([A-Za-z0-9]{40})$/;

export function parseKey(raw) {
  if (typeof raw !== "string") return null;
  const m = raw.match(KEY_RE);
  if (!m) return null;
  return { env: m[1], lookupId: m[2], secret: m[3], raw };
}

export function normalizeScopes(scopes) {
  const set = new Set();
  for (const s of scopes || []) if (VALID_SCOPES.includes(s)) set.add(s);
  return [...set];
}

/**
 * Create a key. Returns { record, rawKey }. The rawKey is the ONLY time the
 * full secret exists outside the caller's memory — it is never stored or logged.
 */
export async function createApiKey(project, { name, env = "live", scopes, createdByUserId }) {
  await connectDB();
  const cleanEnv = env === "test" ? "test" : "live";
  const cleanScopes = normalizeScopes(scopes);
  if (!cleanScopes.length) {
    throw Object.assign(new Error("Select at least one scope."), { code: "VALIDATION_ERROR" });
  }
  if (!name || !String(name).trim()) {
    throw Object.assign(new Error("A key name is required."), { code: "VALIDATION_ERROR" });
  }

  // Unique lookupId (retry on the astronomically unlikely collision).
  let lookupId;
  for (let i = 0; i < 6; i++) {
    lookupId = randToken(12);
    // eslint-disable-next-line no-await-in-loop
    if (!(await ApiKey.exists({ lookupId }))) break;
    lookupId = null;
  }
  if (!lookupId) throw Object.assign(new Error("Could not allocate a key id."), { code: "INTERNAL" });

  const secret = randToken(40);
  const rawKey = `gsk_${cleanEnv}_${lookupId}_${secret}`;
  const keyPrefix = `gsk_${cleanEnv}_${lookupId}`;

  const record = await ApiKey.create({
    projectId: project._id,
    name: String(name).trim().slice(0, 120),
    env: cleanEnv,
    lookupId,
    keyPrefix,
    secretHash: hashRawKey(rawKey),
    scopes: cleanScopes,
    createdByUserId: createdByUserId || null,
  });

  return { record, rawKey };
}

export async function listKeysForProject(projectId) {
  await connectDB();
  return ApiKey.find({ projectId }).sort({ createdAt: -1 });
}

/**
 * Verify a raw key. Returns { ok:true, key } or { ok:false, reason }.
 * Does NOT check project status or scopes — that is the caller's job
 * (lib/apiKeyAuth.js), so this stays a pure credential check.
 */
export async function verifyApiKey(rawKey) {
  const parsed = parseKey(rawKey);
  if (!parsed) return { ok: false, reason: "INVALID_API_KEY" };
  await connectDB();
  const key = await ApiKey.findOne({ lookupId: parsed.lookupId });
  if (!key) return { ok: false, reason: "INVALID_API_KEY" };

  const expected = Buffer.from(key.secretHash, "hex");
  const actual = Buffer.from(hashRawKey(rawKey), "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "INVALID_API_KEY" };
  }
  if (key.status !== "active") return { ok: false, reason: "API_KEY_REVOKED" };
  return { ok: true, key };
}

export async function revokeKey(key) {
  if (key.status !== "revoked") {
    key.status = "revoked";
    key.revokedAt = new Date();
    await key.save();
  }
  return key;
}

/**
 * Safe rotation: mint a NEW key with the same env/scopes, linked back to the
 * old one. The old key is LEFT ACTIVE so a running integration does not break;
 * the caller revokes it explicitly once the new key is deployed. Returns
 * { record, rawKey } for the new key.
 */
export async function rotateKey(oldKey, { createdByUserId } = {}) {
  await connectDB();
  const project = { _id: oldKey.projectId };
  const { record, rawKey } = await createApiKey(project, {
    name: `${oldKey.name} (rotated)`,
    env: oldKey.env,
    scopes: oldKey.scopes,
    createdByUserId,
  });
  record.rotatedFromId = oldKey._id;
  await record.save();
  return { record, rawKey, oldKeyId: String(oldKey._id) };
}

export async function deleteKey(key) {
  // Only revoked keys may be deleted, so a live integration can't be nuked.
  if (key.status !== "revoked") {
    throw Object.assign(new Error("Revoke the key before deleting it."), { code: "CONFLICT" });
  }
  await key.deleteOne();
}

/** Best-effort telemetry: never let a counter write fail an API request. */
export function touchKeyUsage(key) {
  ApiKey.updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date() }, $inc: { "counters.requests": 1 } })
    .exec()
    .catch(() => {});
}

export const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

/**
 * Load a key together with its project, enforcing ownership. Cross-user access
 * returns { notFound:true } (404, not 403 — same IDOR-safe posture as projects).
 */
export async function loadKeyForUser(user, keyId) {
  await connectDB();
  if (!isId(keyId)) return { notFound: true };
  const key = await ApiKey.findById(keyId);
  if (!key) return { notFound: true };
  const project = await Project.findById(key.projectId);
  if (!project) return { notFound: true };
  if (user.role !== "superadmin" && String(project.ownerId) !== String(user._id)) {
    return { notFound: true };
  }
  return { key, project };
}
