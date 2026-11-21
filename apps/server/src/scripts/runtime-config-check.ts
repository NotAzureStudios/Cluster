/* Unset settings fall back to their defaults, never to their minimums.
   Run: npm run -w apps/server runtime-config:check */
import { loadRuntimeConfig } from "../core/runtime-config.js";

const ok = (cond: unknown, msg: string) => { if (!cond) { console.error("FAIL", msg); process.exitCode = 1; } else console.log("PASS", msg); };
const config = loadRuntimeConfig({ env: { NODE_ENV: "development", CLUSTER_CONFIG_PATH: "/nonexistent/cluster.json" } as NodeJS.ProcessEnv, cwd: "/nonexistent" });
ok(config.bodyLimit === 512 * 1024 * 1024, `request body limit defaults to 512 MB (${config.bodyLimit})`);
ok(config.sessionDays === 7, `sessions last 7 days (${config.sessionDays})`);
ok(config.sessionMaxPerUser > 1, `more than one session per user (${config.sessionMaxPerUser})`);
ok(config.requestTimeoutMs >= 15_000, `request timeout is not 1 second (${config.requestTimeoutMs})`);
const blank = loadRuntimeConfig({ env: { NODE_ENV: "development", CLUSTER_CONFIG_PATH: "/nonexistent/cluster.json", CLUSTER_BODY_LIMIT_BYTES: "" } as NodeJS.ProcessEnv, cwd: "/nonexistent" });
ok(blank.bodyLimit === 512 * 1024 * 1024, "a blank environment value also uses the default");
