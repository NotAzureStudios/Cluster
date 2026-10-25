import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("updated roadmap step 7 owns trusted integration provider contracts", async () => {
  const registry = await read("apps/server/src/domains/integrations/integration-provider-registry.ts");
  const routes = await read("apps/server/src/domains/integrations/integration-routes.ts");
  assert.match(registry, /class IntegrationProviderRegistry/);
  assert.match(registry, /source\.gitea/);
  assert.match(registry, /communication\.discord/);
  assert.match(registry, /media\.youtube/);
  assert.match(routes, /trusted-server-registration-only/);
  assert.match(routes, /dynamicCodeLoading: false/);
  assert.doesNotMatch(routes, /discordBotToken:/);
  assert.doesNotMatch(routes, /giteaToken:/);
});

test("updated roadmap step 7 release certification requires browser E2E and UX evidence", async () => {
  const workflow = await read(".github/workflows/release.yml");
  const verifier = await read("tools/scripts/release-verify-artifacts.mjs");
  const e2e = await read("tools/scripts/e2e-ci.mjs");
  assert.match(workflow, /--gate=production-e2e/);
  assert.match(workflow, /--gate=ux-consistency/);
  assert.match(verifier, /"production-e2e"/);
  assert.match(verifier, /"ux-consistency"/);
  assert.match(e2e, /\/api\/projects/);
  assert.match(e2e, /\/api\/command\/search/);
  assert.match(e2e, /\/api\/admin\/integrations\/providers/);
});

test("updated roadmap step 7 API and documentation boundaries are current", async () => {
  const contracts = await read("packages/shared/src/api-contracts.ts");
  const doc = await read("docs/PLATFORM_PRODUCTION_RELEASE.md");
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.version, "0.422.0");
  assert.match(contracts, /2026-08-02\.62/);
  for (const capability of ["integration-provider-contract-v1", "production-e2e-v1", "ux-consistency-v1", "public-release-certification-v2"]) assert.match(contracts, new RegExp(capability));
  assert.match(doc, /Roadmap Step 7 of 7/);
  assert.match(doc, /public-signed/);
  assert.match(doc, /local-unattested/);
});
