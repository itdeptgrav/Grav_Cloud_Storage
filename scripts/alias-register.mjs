// Registers the "@/" alias resolve hook, then loads dotenv. Used via
// `node --import ./scripts/alias-register.mjs <script>`.
import { register } from "node:module";
import "dotenv/config";

// import.meta.url is already a file:// URL — use it directly as the parent base.
register("./alias-hooks.mjs", import.meta.url);
