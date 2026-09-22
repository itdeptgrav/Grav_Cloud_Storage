// Entry point. Routes the visitor based on setup + session state:
//   no super-admin yet → /setup
//   signed in          → /dashboard
//   otherwise          → /login
import { redirect } from "next/navigation";
import { ensureBootstrap, isSetupComplete } from "@/lib/bootstrap";
import { readSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  await ensureBootstrap();
  if (!(await isSetupComplete())) redirect("/setup");
  const session = await readSession();
  redirect(session ? "/dashboard" : "/login");
}
