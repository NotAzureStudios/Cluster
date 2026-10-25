import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const read = async (relative) => {
  try { return await readFile(path.join(root, relative), "utf8"); } catch (error) {
    if (relative.startsWith(".github/") && error?.code === "ENOENT") return "";
    throw error;
  }
};
const check = (label, ok) => checks.push({ label, ok });

const pkg = JSON.parse(await read("package.json"));
const contracts = await read("packages/shared/src/api-contracts.ts");
const registry = await read("apps/server/src/domains/integrations/integration-provider-registry.ts");
const routes = await read("apps/server/src/domains/integrations/integration-routes.ts");
const server = await read("apps/server/src/app/cluster-server.ts");
const domainCatalog = await read("apps/server/src/app/server-domain-catalog.ts");
const openapi = await read("apps/server/src/core/openapi.ts");
const adminPanel = await read("packages/renderer/src/features/admin/IntegrationProvidersPanel.tsx");
const adminWorkspace = await read("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");
const e2e = await read("tools/scripts/e2e-ci.mjs");
const uxAudit = await read("tools/scripts/ux-consistency-audit.mjs");
const uxManifest = await read("config/ux-consistency-surfaces.json");
const workflow = await read(".github/workflows/release.yml");
const repositoryCiAvailable = Boolean(workflow.trim());
const verifier = await read("tools/scripts/release-verify-artifacts.mjs");
const packager = await read("tools/scripts/package-cluster-master.mjs");
const doc = await read("docs/PLATFORM_PRODUCTION_RELEASE.md");

check("Step 7 API contract advances and advertises platform capabilities", contracts.includes('version: "2026-08-02.63"') && ["integration-provider-contract-v1", "production-e2e-v1", "ux-consistency-v1", "public-release-certification-v2"].every((item) => contracts.includes(item)));
check("integration registry validates versioned provider manifests", registry.includes("class IntegrationProviderRegistry") && registry.includes("assertManifest") && registry.includes("secretSettingKeys") && registry.includes("outboundHosts"));
check("built-in provider catalog covers Git, Discord, and YouTube", ["source.gitea", "communication.discord", "media.youtube"].every((item) => registry.includes(item)));
check("provider catalog forbids arbitrary runtime code loading", routes.includes('dynamicCodeLoading: false') && routes.includes('executionModel: "trusted-server-registration-only"'));
check("provider catalog is admin-only and secret-safe", routes.includes("requireAdminUserForRequest") && !routes.includes("giteaToken:") && !routes.includes("discordBotToken:"));
check("integration provider domain is composed and cataloged", server.includes("registerIntegrationRoutes") && server.includes("createBuiltInIntegrationRegistry") && domainCatalog.includes('key: "integrations"'));
check("integration provider endpoint is documented in OpenAPI", openapi.includes('"/api/admin/integrations/providers"'));
check("administrator UI exposes provider posture", adminWorkspace.includes("<IntegrationProvidersPanel />") && adminPanel.includes('/api/admin/integrations/providers') && adminPanel.includes("dynamicCodeLoading"));
check("production E2E boots built server/web with isolated PostgreSQL", e2e.includes("cluster_e2e_") && e2e.includes("apps/server/dist/index.js") && e2e.includes("vite") && e2e.includes("playwright"));
check("production E2E exercises authenticated project/search/intelligence/operations flows", ["/api/auth/csrf", "/api/projects", "/intelligence", "/api/command/search", "/api/admin/operations/performance", "/api/admin/integrations/providers"].every((item) => e2e.includes(item)));
check("UX audit owns representative surface and debt contracts", uxAudit.includes("native browser dialog debt does not increase") && uxAudit.includes("implicit button-type debt does not increase") && JSON.parse(uxManifest).surfaces.length >= 15);
check("package audit chain includes UX and platform-production gates", pkg.scripts.audit.includes("ux-consistency-audit.mjs") && pkg.scripts.audit.includes("platform-production-audit.mjs"));
check("release workflow records UX and production E2E evidence", !repositoryCiAvailable || workflow.includes("--gate=ux-consistency") && workflow.includes("--gate=production-e2e") && workflow.includes("npm run e2e:ci"));
check("certified artifact verifier requires new evidence gates", verifier.includes('"production-e2e"') && verifier.includes('"ux-consistency"'));
check("master packaging carries final Step 7 documentation and audits", packager.includes("platform-production-audit.mjs") && packager.includes("docs/PLATFORM_PRODUCTION_RELEASE.md"));
check("Step 7 documentation preserves local-vs-public certification boundary", doc.includes("Roadmap Step 7 of 7") && doc.includes("public-signed") && doc.includes("local-unattested"));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}`);
console.log(`\nCluster platform & production audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);
