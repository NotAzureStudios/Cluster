import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("Roadmap Step 19 privacy erasure is explicit auditable and legal-hold aware", async () => {
  const [schema, migration, core, routes, admin, compliance, contract, errors, docs] = await Promise.all([
    read("apps/server/prisma/schema.prisma"),
    read("apps/server/prisma/migrations/20260820070000_privacy_erasure_fulfillment/migration.sql"),
    read("apps/server/src/core/privacy-erasure.ts"),
    read("apps/server/src/domains/legal/privacy-data-routes.ts"),
    read("packages/renderer/src/features/legal/PrivacyRequestsAdminPanel.tsx"),
    read("apps/server/src/core/legal-compliance.ts"),
    read("packages/shared/src/api-contracts.ts"),
    read("packages/shared/src/error-codes.ts"),
    read("docs/PRIVACY_ERASURE_FULFILLMENT.md"),
  ]);
  assert.match(schema, /model PrivacyLegalHold/);
  assert.match(schema, /model PrivacyErasureReceipt/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.match(core, /buildPrivacyErasurePlan/);
  assert.match(core, /status !== "approved"/);
  assert.match(core, /PRIVACY_ERASURE_SELF_BLOCKED/);
  assert.match(core, /PRIVACY_ERASURE_LEGAL_HOLD/);
  assert.match(core, /accountState: "PRIVACY_ERASED"/);
  assert.match(core, /security audit evidence/);
  assert.match(routes, /FULFILL PRIVACY ERASURE/);
  assert.match(routes, /CREATE PRIVACY LEGAL HOLD/);
  assert.match(routes, /RELEASE PRIVACY LEGAL HOLD/);
  assert.match(routes, /status: \{ in: \["pending", "approved"\] \}/);
  assert.match(admin, /Preview erasure/);
  assert.match(admin, /Active privacy legal holds/);
  assert.match(compliance, /approvedErasureRequests/);
  assert.match(compliance, /activeLegalHolds/);
  assert.match(contract, /privacy-erasure-fulfillment-v1/);
  assert.match(contract, /2026-08-02\.62/);
  assert.match(errors, /PRIVACY_ERASURE_LEGAL_HOLD/);
  assert.match(docs, /Roadmap Step 19 of 20/);
  assert.match(docs, /does not rewrite historical backup generations/i);
});
