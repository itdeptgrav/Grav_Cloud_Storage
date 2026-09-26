// scripts/storage-maintenance.mjs
// CLI maintenance, reusing the app services (via the @/ alias hook). Usage:
//   npm run storage:integrity        (add -- --full for checksum verification)
//   npm run storage:reconcile        (report; add -- --apply <projectId> to fix)
//   npm run storage:cleanup          (remove stale tmp/*.part)
//   npm run storage:purge-trash      (purge trash past retention)
//   npm run storage:chunks           (expire idle chunked uploads, reap orphan chunk temps)
//   npm run maintenance              (cleanup + chunks + purge-trash)
import mongoose from "mongoose";
import connectDB from "@/lib/db/mongoose";
import { runIntegrityCheck } from "@/lib/integrity";
import { reconcileAll, applyReconcile } from "@/lib/reconcile";
import { cleanTempFiles, purgeExpiredTrash, cleanChunkSessions } from "@/lib/maintenance";
import { describeError } from "@/lib/logSafe";

const cmd = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  await connectDB();
  switch (cmd) {
    case "integrity": {
      const report = await runIntegrityCheck({ full: args.includes("--full") });
      console.log(JSON.stringify({ type: report.type, checked: report.checked, healthy: report.healthy, problems: report.problemCount, durationMs: report.durationMs }, null, 2));
      if (report.problemCount) console.log("Problems:", JSON.stringify(report.problems.slice(0, 50), null, 2));
      break;
    }
    case "reconcile": {
      if (args[0] === "--apply" && args[1]) {
        const r = await applyReconcile(new mongoose.Types.ObjectId(args[1]));
        console.log("Applied:", JSON.stringify(r, null, 2));
      } else {
        const rows = await reconcileAll();
        const drift = rows.filter((r) => !r.inSync);
        console.log(`Reconcile report: ${rows.length} projects, ${drift.length} with drift.`);
        if (drift.length) console.log(JSON.stringify(drift, null, 2));
      }
      break;
    }
    case "cleanup": {
      console.log("Temp cleanup:", JSON.stringify(await cleanTempFiles()));
      break;
    }
    case "purge-trash": {
      console.log("Trash purge:", JSON.stringify(await purgeExpiredTrash()));
      break;
    }
    case "chunks": {
      console.log("Chunked uploads:", JSON.stringify(await cleanChunkSessions()));
      break;
    }
    case "all": {
      console.log("Temp cleanup:", JSON.stringify(await cleanTempFiles()));
      console.log("Chunked uploads:", JSON.stringify(await cleanChunkSessions()));
      console.log("Trash purge:", JSON.stringify(await purgeExpiredTrash()));
      break;
    }
    default:
      console.log("Usage: storage-maintenance <integrity [--full] | reconcile [--apply <id>] | cleanup | chunks | purge-trash | all>");
  }
  await mongoose.disconnect();
  process.exit(0);
}
main().catch((e) => {
  console.error("maintenance error:", describeError(e)); // path-free (scheduled runs log this)
  process.exit(1);
});
