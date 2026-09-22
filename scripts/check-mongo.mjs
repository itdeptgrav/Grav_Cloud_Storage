// scripts/check-mongo.mjs
// Standalone connectivity check for the local Grav Storage database.
//   npm run check:mongo
// Prints version + db name on success, a clear error on failure. Admin CLI —
// safe to show the version here (unlike the public /health endpoint).

import "dotenv/config";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/grav_storage";

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 4000 });
  const info = await mongoose.connection.db.admin().serverInfo();
  console.log("✅ Connected to MongoDB");
  console.log("   URI     :", uri);
  console.log("   Version :", info.version);
  console.log("   DB name :", mongoose.connection.name);
  await mongoose.disconnect();
  process.exit(0);
} catch (e) {
  console.error("❌ Cannot connect to MongoDB");
  console.error("   URI   :", uri);
  console.error("   Error :", e.message);
  console.error("\nIs the local MongoDB service running on port 27017?");
  process.exit(1);
}
