import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("Roadmap Step 18 analytics remains explicit minimized and fail-closed", async () => {
  const [schema, core, routes, consent, client, retention, privacy, contract, docs] = await Promise.all([
    read("apps/server/prisma/schema.prisma"), read("apps/server/src/core/behavioral-analytics.ts"), read("apps/server/src/domains/legal/behavioral-analytics-routes.ts"), read("apps/server/src/core/privacy-consent.ts"), read("packages/renderer/src/core/privacy-consent.ts"), read("apps/server/src/core/data-retention.ts"), read("apps/server/src/domains/legal/privacy-data-routes.ts"), read("packages/shared/src/api-contracts.ts"), read("docs/BEHAVIORAL_ANALYTICS_CONSENT.md"),
  ]);
  assert.match(schema, /model BehavioralAnalyticsProvider/); assert.match(schema, /model BehavioralAnalyticsEvent/);
  assert.match(core, /cluster_first_party/); assert.match(core, /ANALYTICS_EVENT_NAMES = \["app_open", "screen_view"\]/);
  assert.match(routes, /ANALYTICS_CONSENT_REQUIRED/); assert.match(routes, /ANALYTICS_PROVIDER_REVIEW_REQUIRED/); assert.match(routes, /consent\.analytics !== true/);
  assert.match(consent, /PRIVACY_CONSENT_SCHEMA_VERSION = 2/); assert.match(consent, /PRIVACY_CONSENT_NOTICE_VERSION = "2\.0"/);
  assert.match(client, /analyticsAllowed/); assert.match(retention, /behavioral_analytics/); assert.match(privacy, /behavioralAnalyticsEvents/);
  assert.match(contract, /behavioral-analytics-consent-v1/); assert.match(contract, /2026-08-02\.62/); assert.match(docs, /Roadmap Step 18 of 20/);
});
