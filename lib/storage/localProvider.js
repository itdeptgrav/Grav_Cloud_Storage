// lib/storage/localProvider.js
// The LocalStorageProvider — file bytes on this server's own disk.
//
// Phase 0 establishes the directory layout and a writability probe. The
// streaming methods (beginWrite / commit / openRead / stat / exists / remove)
// arrive in Phase 2; business/API code will always go through the provider,
// never fs directly.
//
// Layout (STORAGE_ROOT points at the data dir; tmp/ and trash/ are siblings):
//   <STORAGE_ROOT>\                      e.g. D:\GravStorage\data
//     <projectId>\objects\<YYYY>\<MM>\<fileId>.bin
//   <base>\tmp\                          in-flight uploads (.part)
//   <base>\trash\                        purged-pending bytes
//
// The absolute path is PRIVATE to this module. Nothing here returns it to an
// API response.

import fs from "fs";
import path from "path";
import config from "@/lib/config";

const DATA_DIR = path.resolve(config.storageRoot); // …\GravStorage\data
const BASE_DIR = path.dirname(DATA_DIR); //           …\GravStorage
const TMP_DIR = path.join(BASE_DIR, "tmp");
const TRASH_DIR = path.join(BASE_DIR, "trash");

export const name = "local";

/** Internal only — never surface these through the API. */
export const dirs = { DATA_DIR, BASE_DIR, TMP_DIR, TRASH_DIR };

/** Create the storage directory tree if it does not exist. */
export async function ensureStorage() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  await fs.promises.mkdir(TMP_DIR, { recursive: true });
  await fs.promises.mkdir(TRASH_DIR, { recursive: true });
}

/**
 * Health probe: ensure the data dir exists and is writable by writing and
 * deleting a tiny file. Returns only { ok } (+ error) so a caller can surface
 * it publicly without leaking the path.
 */
export async function checkStorageAccess() {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const probe = path.join(DATA_DIR, `.probe-${process.pid}-${Date.now()}`);
    await fs.promises.writeFile(probe, "ok");
    await fs.promises.unlink(probe);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export default {
  name,
  dirs,
  ensureStorage,
  checkStorageAccess,
};
