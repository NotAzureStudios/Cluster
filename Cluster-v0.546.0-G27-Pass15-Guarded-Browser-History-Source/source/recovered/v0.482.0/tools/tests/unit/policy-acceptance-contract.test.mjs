import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(`../../../${relative}`, import.meta.url), "utf8");

test("Roadmap Step 17 policy acceptance remains explicit and version-bound", async () => {
  const [core, routes, schema, migration, server, screen, docs, contract] = await Promise.all([
    read("apps/server/src/core/policy-acceptance.ts"),
    read("apps/server/src/domains/legal/policy-acceptance-routes.ts"),
    read("apps/server/prisma/schema.prisma"),
    read("apps/server/prisma/migrations/20260820030000_policy_acceptance/migration.sql"),
    read("apps/server/src/app/cluster-server.ts"),
    read("packages/renderer/src/features/legal/PolicyAcceptanceScreen.tsx"),
    read("docs/AUDITABLE_POLICY_ACCEPTANCE.md"),
    read("packages/shared/src/api-contracts.ts"),
  ]);
  assert.match(schema, /acceptanceMode\s+String\s+@default\("none"\)/);
  assert.match(migration, /"acceptanceMode" TEXT NOT NULL DEFAULT 'none'/);
  assert.match(core, /verifyPolicyAcceptanceEvidence/);
  assert.match(core, /normalizePolicyAcceptanceMode\(row\.acceptanceMode\) !== "none"/);
  assert.match(routes, /attestation: z\.literal\(true\)/);
  assert.match(routes, /POLICY_ACCEPTANCE_STALE/);
  assert.match(server, /POLICY_ACCEPTANCE_REQUIRED/);
  assert.match(screen, /I acknowledge that I reviewed/);
  assert.match(screen, /I accept/);
  assert.match(docs, /does not infer consent from sign-in/);
  assert.match(contract, /policy-acceptance-v1/);
  assert.match(contract, /2026-08-02\.62/);
});
