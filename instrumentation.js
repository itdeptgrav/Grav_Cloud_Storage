// instrumentation.js
// Runs once when a Next.js server starts, before it serves any request.
//
// On a production server every console line of this process goes through
// lib/logSafe's redact(): no absolute filesystem path (the storage directory,
// the app directory, temp or home) and no credential-looking value reaches the
// logs — including Next.js's own error output and routes not wrapped by withLog.
// Our own log lines are already path-free (logError); this is the safety net.
// `next dev` keeps full paths for local debugging.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { installConsoleRedaction } = await import("@/lib/logSafe");
    installConsoleRedaction();
  }
}
