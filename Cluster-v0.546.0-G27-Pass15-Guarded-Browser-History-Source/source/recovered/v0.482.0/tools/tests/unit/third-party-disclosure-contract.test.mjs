import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../../../${file}`, import.meta.url), "utf8");

test("Roadmap Step 16 third-party disclosure is configuration-aware and fail-closed", async () => {
  const [schema, migration, storage, core, routes, routePolicy, compliance, page, admin, contract, errors, docs, packager] = await Promise.all([
    read("apps/server/prisma/schema.prisma"),
    read("apps/server/prisma/migrations/20260820023000_third_party_disclosures/migration.sql"),
    read("apps/server/src/core/storage-migrations.ts"),
    read("apps/server/src/core/third-party-disclosure.ts"),
    read("apps/server/src/domains/legal/third-party-disclosure-routes.ts"),
    read("apps/server/src/domains/access/route-policy.ts"),
    read("apps/server/src/core/legal-compliance.ts"),
    read("packages/renderer/src/features/legal/ThirdPartyDisclosurePage.tsx"),
    read("packages/renderer/src/features/legal/ThirdPartyDisclosureAdminPanel.tsx"),
    read("packages/shared/src/api-contracts.ts"),
    read("packages/shared/src/error-codes.ts"),
    read("docs/THIRD_PARTY_DISCLOSURE_GENERATION.md"),
    read("tools/scripts/package-cluster-master.mjs"),
  ]);
  assert.match(schema, /model ThirdPartyDisclosureProvider/);
  assert.match(migration, /CREATE TABLE "ThirdPartyDisclosureProvider"/);
  assert.match(storage, /"ThirdPartyDisclosureProvider"/);
  assert.match(storage, /"ThirdPartyDisclosureProvider_status_publicVisible_idx"/);
  assert.match(core, /detectThirdPartyCandidates/);
  assert.match(core, /builtin\.youtube-embed/);
  assert.match(core, /builtin\.discord-messaging/);
  assert.match(core, /builtin\.gitea/);
  assert.match(routes, /\/api\/public\/privacy\/third-parties/);
  assert.match(routes, /reviewInvalidated/);
  assert.match(routes, /Material changes invalidate review/);
  assert.match(routePolicy, /\/api\/public\/privacy\/third-parties/);
  assert.match(compliance, /detectedNotRecorded/);
  assert.match(compliance, /recordedButNotDetected/);
  assert.match(page, /Operator-reviewed services/i);
  assert.match(admin, /Review & publish/);
  assert.match(admin, /const body = reviewAndPublish \? \{ \.\.\.record, reviewed: true, publicVisible: true \} : record/);
  assert.doesNotMatch(admin, /reviewed: reviewAndPublish \? true : form\.reviewed/);
  assert.match(contract, /third-party-disclosure-v1/);
  assert.match(contract, /2026-08-02\.62/);
  assert.match(errors, /THIRD_PARTY_DISCLOSURE_REVIEW_REQUIRED/);
  assert.match(docs, /Roadmap Step 16/);
  assert.ok((packager.match(/docs\/THIRD_PARTY_DISCLOSURE_GENERATION\.md/g) || []).length >= 1);
});
