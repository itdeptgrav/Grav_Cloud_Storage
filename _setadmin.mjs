// Ensure a super-admin with a given email + password exists in a MongoDB.
// URI passed as an arg so no credentials are stored in this file.
//
//   node _setadmin.mjs "<mongodb uri ending in /grav_storage>" <email> "<password>"
//
// - If the email already exists  -> promote it to active super-admin + set password.
// - Else if exactly one admin    -> rename that admin to this email + set password.
// - Else                         -> create a new super-admin.
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

const [uri, emailArg, password] = process.argv.slice(2);
if (!uri || !emailArg || !password) {
  console.error('Usage: node _setadmin.mjs "<uri>" <email> "<password>"');
  process.exit(1);
}
if (password.length < 8) { console.error("Password must be at least 8 characters."); process.exit(1); }
const email = emailArg.toLowerCase().trim();

const c = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 15000 });
if (!c.db().databaseName || c.db().databaseName === "test") {
  console.error(`Refusing to write to database "${c.db().databaseName}". End the URI with /grav_storage.`);
  process.exit(1);
}
const users = c.db().collection("users");
const hash = await bcrypt.hash(password, 12);
const now = new Date();

let action;
const byEmail = await users.findOne({ email });
if (byEmail) {
  await users.updateOne({ _id: byEmail._id }, { $set: { passwordHash: hash, role: "superadmin", status: "active", mustChangePassword: false, updatedAt: now } });
  action = `promoted existing user ${email} to super-admin (password set)`;
} else {
  const admins = await users.find({ role: "superadmin" }).toArray();
  if (admins.length === 1) {
    await users.updateOne({ _id: admins[0]._id }, { $set: { email, passwordHash: hash, status: "active", mustChangePassword: false, updatedAt: now } });
    action = `renamed admin ${admins[0].email} -> ${email} (password set)`;
  } else {
    await users.insertOne({ name: "Super Admin", email, passwordHash: hash, role: "superadmin", status: "active", mustChangePassword: false, createdAt: now, updatedAt: now });
    action = `created new super-admin ${email}`;
  }
}
console.log(`✓ ${c.db().databaseName}: ${action}`);
console.log(`Log in with:  ${email}  /  (the password you passed)`);
await c.close();
process.exit(0);
