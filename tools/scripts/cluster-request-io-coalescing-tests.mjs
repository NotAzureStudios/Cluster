import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = async p => fs.readFile(path.join(root, p), "utf8");
function loadTypescript(pathname, mocks) {
  const source = ts.transpileModule(
    mocks.source,
    { fileName: pathname, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } },
  );
  assert.equal((source.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  new Function("require", "module", "exports", source.outputText)(name => {
    if (name === "node:crypto") return crypto;
    assert.ok(Object.hasOwn(mocks.modules, name), "unknown security module " + name);
    return mocks.modules[name];
  }, module, module.exports);
  return module.exports;
}
const { createServerUpdateMaintenanceProbe } = loadTypescript(
  "server-update-maintenance.ts", {
    source: await read("apps/server/src/core/server-update-maintenance.ts"),
    modules: { "node:fs/promises": await import("node:fs/promises"), "node:path": require("node:path") },
  },
);
let checks = 0;
const check = async (name, run) => { await run(); checks++; console.log("PASS " + name); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
await check("concurrent hold checks share only the in-flight filesystem call", async () => {
  const gate = deferred();
  let calls = 0;
  const probe = createServerUpdateMaintenanceProbe(async () => {
    calls++;
    await gate.promise;
    throw Object.assign(new Error("not found"), { code: "ENOENT" });
  });
  const pending = Array.from({ length: 40 }, () => probe("/cluster"));
  assert.equal(calls, 1, "one filesystem lookup for a burst of requests");
  gate.resolve();
  assert.deepEqual(await Promise.all(pending), Array(40).fill(false));
  assert.equal(await probe("/cluster"), false);
  assert.equal(calls, 2, "negative result must not be cached between requests");
});
await check("hold errors fail closed, and other roots are not cross-coalesced", async () => {
  const firstGate = deferred();
  let calls = 0;
  const probe = createServerUpdateMaintenanceProbe(async filename => {
    calls++;
    if (filename.includes("root1")) await firstGate.promise;
    else throw Object.assign(new Error("access denied"), { code: "EPERM" });
    return { isFile: () => false };
  });
  const first = probe("/root1");
  assert.equal(await probe("/root2"), true);
  firstGate.resolve();
  assert.equal(await first, true);
  assert.equal(calls, 2);
});
await check("real filesystem holds admit before and deny during update", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-hold-"));
  try {
    const probe = createServerUpdateMaintenanceProbe();
    assert.equal(await probe(folder), false);
    const runtime = path.join(folder, "system", "runtime");
    await fs.mkdir(runtime, { recursive: true });
    await fs.writeFile(path.join(runtime, "cluster-update-hold.json"), "{}");
    assert.equal(await probe(folder), true);
    await fs.unlink(path.join(runtime, "cluster-update-hold.json"));
    assert.equal(await probe(folder), false);
  } finally {
    await fs.rm(folder, { force: true, recursive: true });
  }
});
const securitySource = await read("apps/server/src/app/server-request-security-services.ts");
const { createRequestSecurityServices } = loadTypescript("server-request-security-services.ts", {
  source: securitySource,
  modules: {
    "../core/outbound-http.js": { secureOutboundFetch: () => {} },
    "../core/security.js": { mutationOriginDecisionForRequest: () => ({ allowed: true }) },
    "../core/studio-security-policy.js": { normalizeStudioSecurityPolicy: (v, defaults) => ({
      sessionDays: v?.sessionDays ?? defaults.sessionDays,
      sessionIdleHours: v?.sessionIdleHours ?? defaults.sessionIdleHours,
      sessionMaxPerUser: defaults.sessionMaxPerUser,
    }) },
    "../domains/sessions/session-device.js": {
      requestDeviceId: () => null, requestDevicePlatform: () => "web", touchDeviceRegistration: async () => {},
    },
    "../domains/workforce/workforce-user-authority.js": { WORKFORCE_USER_AUTHORITY_INCLUDE: {} },
  },
});
function securityHarness(readSettings) {
  let sessionReads = 0;
  const deps = {
    AUTH_SECRET: "test-secret", CONFIGURED_CORS_ORIGINS: new Set(),
    RATE_LIMIT_ENABLED: false, REQUEST_TIMEOUT_MS: 3_000, REQUIRE_MUTATION_ORIGIN: false,
    SECURITY_HEADERS_ENABLED: false, SESSION_COOKIE: "cluster_session",
    SESSION_DAYS: 7, SESSION_IDLE_HOURS: 12, SESSION_MAX_PER_USER: 5, SESSION_SECURE: false,
    readSettings, rateLimiter: {},
    prisma: { session: { findUnique: async () => {
      sessionReads++;
      return {
        id: "session", userId: "u", tokenHash: "hash",
        authenticationGeneration: 1, revokedAt: null,
        expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(Date.now() - 60_000),
        lastSeenAt: new Date(Date.now() - 20_000),
        user: { id: "u", authenticationGeneration: 1 },
      };
    } } },
  };
  const services = createRequestSecurityServices(deps);
  return { services, get sessionReads() { return sessionReads; } };
}
const req = () => ({ cookies: { cluster_session: "test-token" }, headers: {} });
await check("simultaneous authenticated reads share one security policy fetch", async () => {
  const gate = deferred();
  let settingsReads = 0;
  const h = securityHarness(async () => { settingsReads++; return gate.promise; });
  const promises = Array.from({ length: 30 }, () => h.services.getCurrentSession(req()));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(settingsReads, 1, "one policy read per pending refresh across requests");
  gate.resolve({ sessionDays: 7, sessionIdleHours: 12 });
  const sessions = await Promise.all(promises);
  assert.equal(sessions.filter(Boolean).length, 30);
  assert.equal(h.sessionReads, 30, "session identity still verified independently");
  assert.ok(await h.services.getCurrentSession(req()));
  assert.equal(settingsReads, 1, "fresh policy cache reused without refetch");
});
await check("failed security policy loads are not cached and next request can recover", async () => {
  let calls = 0;
  const h = securityHarness(async () => {
    calls++;
    if (calls === 1) throw new Error("temporary settings failure");
    return { sessionDays: 7, sessionIdleHours: 12 };
  });
  await assert.rejects(h.services.getCurrentSession(req()), /temporary settings failure/);
  assert.ok(await h.services.getCurrentSession(req()));
  assert.equal(calls, 2);
});
const infrastructure = await read("apps/server/src/app/server-request-infrastructure.ts");
assert.match(infrastructure, /await serverUpdateMaintenanceHeld\(dataRoot\)/);
console.log(checks + "/" + checks + " safe request I/O coalescing checks passed");
