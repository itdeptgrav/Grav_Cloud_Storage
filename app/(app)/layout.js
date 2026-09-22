// Protected layout for the signed-in dashboard. Verifies the session against
// the database on the server (no flash of protected content) and renders the
// app shell. Every API route re-checks auth too — defense in depth.
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { connectDB } from "@/lib/db/mongoose";
import User from "@/lib/db/models/User";
import AppShell from "@/components/AppShell";
import ForceChangeGate from "@/components/ForceChangeGate";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }) {
  const session = await readSession();
  if (!session) redirect("/login");
  await connectDB();
  const user = await User.findById(session.id);
  if (!user || user.status !== "active") redirect("/login");
  const safe = user.toSafeJSON();
  return (
    <AppShell user={safe}>
      <ForceChangeGate mustChange={safe.mustChangePassword}>{children}</ForceChangeGate>
    </AppShell>
  );
}
