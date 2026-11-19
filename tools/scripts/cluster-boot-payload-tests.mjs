// The boot contract: one request, and the payload shaped by who is asking.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const route = read("../../apps/server/src/app/server-routes-bootstrap.ts");
const startup = read("../../packages/renderer/src/features/application/application-runtime-ux.tsx");
const policy = read("../../apps/server/src/domains/access/request-policy.ts");
const authContext = read("../../packages/renderer/src/core/api/auth-context.ts");
const cover = read("../../packages/renderer/src/features/auth/PublicClusterCover.tsx");

let passed = 0;
const check = (name, condition) => { assert.ok(condition, name); passed += 1; console.log(`PASS ${name}`); };

check("boot is a single request", (startup.match(/await api</g) || []).length === 1
  && startup.includes('"/api/bootstrap"')
  && !startup.includes('"/api/setup/status"')
  && !/api<[^>]*>\("\/api\/me"\)/.test(startup));

// Everything the signed-out branch returns, from the guard to its own return.
const signedOutBranch = route.slice(route.indexOf("if (!decorated)"), route.indexOf("const settings = await readSettings()"));

check("studio settings are never served to a signed-out visitor",
  signedOutBranch.includes("settings: null") && signedOutBranch.includes("user: null"));

check("the signed-out branch never reads studio settings",
  signedOutBranch.length > 0 && !signedOutBranch.includes("readSettings()")
  && !signedOutBranch.includes("studioSettingsForClient"));

check("boot binds the offline account scope, as /api/me did",
  authContext.includes('"/api/bootstrap"'));

check("boot is reachable without a session", /\/api\/bootstrap"\) return normalizedMethod === "GET"/.test(policy));

check("the deleted compliance routes are out of the public allowlist",
  !policy.includes("/api/public/legal/") && !policy.includes("/api/public/privacy/") && !policy.includes("/api/public/copyright/"));

check("settings are seeded into the cache the shell already reads",
  startup.includes('setApiQueryData("/api/settings"') && startup.includes("staleMs: 30_000"));

check("the sign-in screen issues no request of its own",
  !cover.includes('api<') || !/useEffect/.test(cover));

check("application forms load on the Apply click, not at boot",
  cover.includes("async function openApply()") && cover.includes("/api/public/v1/studio-cover")
  && !/useEffect\([\s\S]{0,200}studio-cover/.test(cover));

check("the Apply predicate matches the cover route exactly",
  route.includes("publicApplication === true") && route.includes('acceptingResponses !== false'));

console.log(`\n${passed}/10 boot contract checks passed`);
