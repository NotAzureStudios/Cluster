import test from "node:test";
import assert from "node:assert/strict";
import { legalComplianceSnapshot } from "../../../apps/server/src/core/legal-compliance.js";

const NOW = new Date("2026-08-20T12:00:00.000Z");

function prismaMock() {
  return {
    legalPolicyVersion: { findMany: async () => [
      { id: "privacy-1", kind: "privacy", version: "1.0", status: "published", effectiveAt: new Date("2026-08-01T00:00:00Z"), publishedAt: new Date("2026-07-31T00:00:00Z"), createdAt: new Date(), updatedAt: new Date(), contentHash: "a".repeat(64), metadataJson: null },
      { id: "security-1", kind: "security_vulnerability_disclosure", version: "1.0", status: "published", effectiveAt: new Date("2026-08-01T00:00:00Z"), publishedAt: new Date("2026-07-31T00:00:00Z"), createdAt: new Date(), updatedAt: new Date(), contentHash: "b".repeat(64), metadataJson: JSON.stringify({ contacts: ["mailto:security@example.com"], expires: "2026-08-25T00:00:00.000Z", preferredLanguages: ["en"], encryption: null, acknowledgments: null }) },
    ] },
    dataRetentionPolicy: { findMany: async () => [{ category: "sessions", enabled: true, retentionDays: 30, updatedAt: new Date("2026-08-10T00:00:00Z") }] },
    dataRetentionRun: { findFirst: async () => ({ id: "run-1", status: "completed", mode: "apply", trigger: "manual", createdAt: new Date("2026-08-10T00:00:00Z"), completedAt: new Date("2026-08-10T00:01:00Z") }) },
    privacyDataRequest: { count: async () => 2 },
    privacyConsentPreference: { count: async () => 4 },
    copyrightCase: { count: async (input: any) => input?.where?.legalActionReceivedAt ? 1 : 3 },
    copyrightResourceRestriction: { count: async () => 1 },
    copyrightCounterNotice: { count: async () => 2 },
  };
}

test("legal compliance center reports configuration state without claiming certification", async () => {
  const snapshot = await legalComplianceSnapshot(prismaMock(), NOW);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.posture.legalCertification, false);
  assert.match(snapshot.posture.note, /not a legal, privacy, accessibility, or regulatory certification/i);
  assert.equal(snapshot.privacy.pendingDataRequests, 2);
  assert.equal(snapshot.copyright.openCases, 3);
  assert.equal(snapshot.copyright.legalHolds, 1);
  assert.ok(snapshot.warnings.some((warning) => warning.key === "privacy:pending-requests"));
  assert.ok(snapshot.warnings.some((warning) => warning.key === "security:expires-soon"));
  assert.ok(snapshot.warnings.some((warning) => warning.key === "unpublished:terms"));
});
