import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), "utf8");
const pkg = JSON.parse(await read("apps/server/package.json"));
const server = await read("apps/server/src/app/cluster-server.ts");
const requestDomain = await read("apps/server/src/app/server-services-request-domain.ts");
const readiness = await read("apps/server/src/core/readiness-probe.ts");
const outbound = await read("apps/server/src/core/outbound-http.ts");
const calendar = await read("apps/server/src/domains/planning/calendar-routes.ts");
const automation = await read("apps/server/src/domains/automation/studio-automation-service.ts");
const workflow = await read("apps/server/src/domains/projects/project-workflow-routes.ts");
const legalCompliance = await read("apps/server/src/domains/legal/legal-compliance-routes.ts");
const thirdParty = await read("apps/server/src/domains/legal/third-party-disclosure-routes.ts");
const policyFiles = await Promise.all([
  "copyright-policy-routes.ts",
  "operator-agreement-routes.ts",
  "privacy-policy-routes.ts",
  "security-disclosure-policy-routes.ts",
  "terms-policy-routes.ts",
].map((file) => read(`apps/server/src/domains/legal/${file}`)));

const checks = [];
const check = (label, ok) => checks.push({ label, ok: Boolean(ok) });
const fastifyVersion = String(pkg.dependencies?.fastify || "");
const legacyLoggingApi = /^5\.(?:0|1|2)\./.test(fastifyVersion);

check("Fastify dependency is explicitly pinned", /^\d+\.\d+\.\d+$/.test(fastifyVersion));
check("Fastify 5.0-5.2 does not use the newer LogController API", !legacyLoggingApi || (!server.includes("LogController") && !server.includes("logController:")));
check("Fastify 5.0-5.2 uses supported disableRequestLogging option", !legacyLoggingApi || server.includes("disableRequestLogging: RUNTIME_CONFIG.disableRequestLogging"));
check("disabledToolLabel is declared before it is exported", /function disabledToolLabel\([^)]*\)[\s\S]*return null;/.test(requestDomain));
check("calendar user-scope authorization names ownerUserId explicitly", calendar.includes("ownerUserId: ownerId"));
check("readiness snapshots expose a common ReadinessProbeResult contract", readiness.includes("snapshot(): ReadinessProbeResult | null"));
check("outbound Response wraps Node Buffer as a web-compatible byte body", outbound.includes("new Response(new Uint8Array(result.body)"));
check("studio automation exports its event contract", automation.includes("export type AutomationEvent ="));
check("project workflow consumes the shared automation event contract", workflow.includes('import type { AutomationEvent } from "../automation/studio-automation-service.js"') && workflow.includes("processEvent: (event: AutomationEvent"));
check("legal compliance accepts typed settings objects without requiring an index signature", legalCompliance.includes("readSettings: () => Promise<object>") && legalCompliance.includes("{ ...(await readSettings()) } as Record<string, unknown>"));
check("third-party disclosure adapts typed settings to detector records locally", thirdParty.includes("readSettings: () => Promise<object>") && thirdParty.includes("const settingsRecord = { ...settings } as Record<string, unknown>") && thirdParty.includes("detectThirdPartyCandidates(settingsRecord)"));
check("legal policy fallback settings stay indexable after catch", policyFiles.every((source) => source.includes("const settings: Record<string, any> = await readSettings().catch(() => ({} as Record<string, any>));")));
check("Calendar no longer references an undeclared ownerUserId shorthand", !calendar.includes("{ ownerUserId, tool:"));
check("outbound HTTP no longer passes Node Buffer directly to web Response", !outbound.includes("new Response(result.body"));

for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}`);
const failed = checks.filter((item) => !item.ok);
console.log(`\nCluster server build compatibility audit: ${checks.length - failed.length}/${checks.length} passed.`);
if (failed.length) process.exit(1);
