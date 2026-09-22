// lib/db/mongoose.js
// A single, cached Mongoose connection to the SEPARATE local Grav Storage
// database. The cache survives Next.js hot-reloads (which would otherwise open
// a new connection on every change) by hanging it off globalThis.
//
// Connecting is graceful: if MongoDB is unreachable the app still boots and
// /health reports database: "down" rather than crashing.

import mongoose from "mongoose";
import config from "@/lib/config";

let cached = globalThis.__gravStorageMongoose;
if (!cached) {
  cached = globalThis.__gravStorageMongoose = { conn: null, promise: null };
}

export async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose
      .connect(config.mongoUri, {
        // Fail fast so a down database does not hang requests.
        serverSelectionTimeoutMS: 4000,
      })
      .then((m) => m)
      .catch((err) => {
        // Reset so the next call retries instead of caching a rejected promise.
        cached.promise = null;
        throw err;
      });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

/** Liveness probe for /health. Returns only { ok } (+ error on failure). */
export async function pingDatabase() {
  try {
    const conn = await connectDB();
    await conn.connection.db.admin().command({ ping: 1 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export default connectDB;
