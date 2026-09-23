// Reset (or set) a user's password directly against the configured MongoDB.
// Run this ON THE HOST that has the target .env (its MONGODB_URI decides which
// database is touched). Uses the app's own bcrypt hashing.
//
//   node --env-file=.env --import ./scripts/alias-register.mjs scripts/reset-admin.mjs <email> "<newPassword>"
//
// With no email, it targets the (single) super-admin. It only ever UPDATES an
// existing account — it never creates one. Prints what it changed (never the hash).
import mongoose from "mongoose";
import { connectDB } from "@/lib/db/mongoose";
import User from "@/lib/db/models/User";
import { hashPassword, passwordProblem } from "@/lib/auth/password";

const [emailArg, passwordArg] = process.argv.slice(2);

async function main() {
  const password = passwordArg;
  if (!password) {
    console.error('Usage: reset-admin.mjs <email> "<newPassword>"   (email optional → super-admin)');
    process.exit(1);
  }
  const problem = passwordProblem(password);
  if (problem) { console.error("Rejected:", problem); process.exit(1); }

  await connectDB();
  const uri = process.env.MONGODB_URI || "(default localhost)";
  console.log("Database:", uri.replace(/\/\/[^@]*@/, "//<redacted>@")); // hide any inline creds

  let user;
  if (emailArg) {
    user = await User.findOne({ email: String(emailArg).toLowerCase().trim() });
    if (!user) { console.error(`No user with email ${emailArg} in this database.`); process.exit(2); }
  } else {
    const admins = await User.find({ role: "superadmin" });
    if (admins.length === 0) { console.error("No super-admin exists in this database. Use /setup to create one."); process.exit(2); }
    if (admins.length > 1) { console.error(`Multiple super-admins (${admins.map((a) => a.email).join(", ")}). Pass an explicit email.`); process.exit(2); }
    user = admins[0];
  }

  user.passwordHash = await hashPassword(password);
  user.mustChangePassword = false;
  if (user.status !== "active") user.status = "active";
  await user.save();

  console.log(`✓ Password reset for ${user.email} (role: ${user.role}). You can now sign in with the new password.`);
  await mongoose.disconnect();
  process.exit(0);
}
main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
