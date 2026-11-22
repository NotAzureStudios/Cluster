import "dotenv/config";
import { startClusterServer } from "./app/cluster-server.js";

// Node exits on an unhandled rejection by default: one stray failed promise
// (a background refresh, a fire-and-forget write) took the whole API down
// until the Host restarted it. Log it and keep serving; requests already
// fail on their own errors.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (Server kept running):", reason instanceof Error ? reason.stack || reason.message : reason);
});

await startClusterServer();
