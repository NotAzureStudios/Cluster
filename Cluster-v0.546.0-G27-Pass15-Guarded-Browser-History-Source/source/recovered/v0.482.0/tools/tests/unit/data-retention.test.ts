import assert from "node:assert/strict";
import test from "node:test";
import {
  CONFIGURABLE_RETENTION_POLICIES,
  dataInventorySnapshot,
  readRetentionPolicies,
  retentionPreview,
  updateRetentionPolicies,
} from "../../../apps/server/src/core/data-retention.js";

function countModel(total: number, eligible = 0) {
  return {
    count: async (args?: any) => args?.where ? eligible : total,
    deleteMany: async () => ({ count: eligible }),
  };
}

function fakePrisma() {
  const policies = new Map<string, any>();
  return {
    dataRetentionPolicy: {
      upsert: async ({ where, create, update }: any) => {
        const current = policies.get(where.category);
        const next = current ? { ...current, ...update, updatedAt: new Date() } : { ...create, createdAt: new Date(), updatedAt: new Date() };
        policies.set(where.category, next);
        return next;
      },
      findMany: async () => [...policies.values()],
    },
    activityEvent: countModel(120, 12),
    persistenceAuditLog: countModel(80, 8),
    session: countModel(20, 4),
    discordLinkChallenge: countModel(5, 2),
    clusterSyncReceipt: countModel(30, 6),
    clusterSyncConflict: countModel(15, 2),
    syncTombstone: countModel(18, 5),
    securityAuditEvent: countModel(42),
    legalPolicyVersion: countModel(4),
    privacyDataRequest: countModel(3),
    project: countModel(7),
    projectFile: countModel(19),
    user: countModel(11),
    $transaction: async (operations: any[]) => Promise.all(operations),
  } as any;
}

test("retention policy definitions keep safety minimums", () => {
  assert.equal(CONFIGURABLE_RETENTION_POLICIES.length, 7);
  for (const policy of CONFIGURABLE_RETENTION_POLICIES) {
    assert.ok(policy.minimumDays >= 1);
    assert.ok(policy.defaultDays >= policy.minimumDays);
    assert.ok(policy.defaultDays <= policy.maximumDays);
  }
  const tombstones = CONFIGURABLE_RETENTION_POLICIES.find((row) => row.key === "sync_tombstones");
  assert.ok(tombstones && tombstones.minimumDays >= 30);
});

test("retention policy updates reject unsafe category windows", async () => {
  const prisma = fakePrisma();
  await assert.rejects(() => updateRetentionPolicies(prisma, [{ category: "sync_tombstones", enabled: true, retentionDays: 1 }], "admin"), /between 30 and 365 days/);
  await assert.rejects(() => updateRetentionPolicies(prisma, [{ category: "not-real", enabled: true, retentionDays: 90 }], "admin"), /Unknown retention category/);
  await updateRetentionPolicies(prisma, [{ category: "sync_tombstones", enabled: true, retentionDays: 120 }], "admin");
  const policies = await readRetentionPolicies(prisma);
  assert.equal(policies.find((row) => row.key === "sync_tombstones")?.retentionDays, 120);
});

test("retention preview reports eligible counts without deleting", async () => {
  const prisma = fakePrisma();
  const rows = await retentionPreview(prisma, 365, new Date("2026-08-19T05:00:00.000Z"));
  assert.equal(rows.find((row) => row.key === "activity_events")?.wouldDelete, 12);
  assert.equal(rows.find((row) => row.key === "auth_challenges")?.wouldDelete, 2);
  assert.equal(rows.find((row) => row.key === "sync_tombstones")?.wouldDelete, 5);
});

test("inventory keeps security evidence and authoritative work outside automatic retention", async () => {
  const prisma = fakePrisma();
  const inventory = await dataInventorySnapshot(prisma, { auditRetentionDays: 365, backupRetentionDays: 21 });
  assert.ok(inventory.protected.some((row) => row.key === "security_audit_events"));
  assert.ok(inventory.protected.some((row) => row.key === "core_work_records"));
  assert.ok(inventory.protected.some((row) => row.key === "authoritative_uploads"));
  assert.ok(!inventory.configurable.some((row) => row.key === "security_audit_events"));
  assert.equal(inventory.delegated.find((row) => row.key === "backup_generations")?.retentionDays, 21);
});
