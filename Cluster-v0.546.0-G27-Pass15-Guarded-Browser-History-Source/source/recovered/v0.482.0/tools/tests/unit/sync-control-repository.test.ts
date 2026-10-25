import assert from "node:assert/strict";
import test from "node:test";
import { createSyncControlRepository } from "../../../apps/server/src/domains/sync/sync-control-repository.js";

test("sync device registration refuses an existing device owned by another account", async () => {
  const prisma: any = {
    clusterSyncDevice: {
      async findUnique() { return { userId: "user-a" }; },
    },
  };
  const repo = createSyncControlRepository(prisma);
  const result = await repo.registerDevice({ id: "device-1", userId: "user-b" });
  assert.equal(result.ownershipConflict, true);
});

test("sync device registration detects a cross-user upsert race", async () => {
  const now = new Date();
  const prisma: any = {
    clusterSyncDevice: {
      async findUnique() { return null; },
      async upsert() { return { id: "device-race", userId: "user-a", lastSeenAt: now }; },
    },
  };
  const repo = createSyncControlRepository(prisma);
  const result = await repo.registerDevice({ id: "device-race", userId: "user-b" });
  assert.equal(result.ownershipConflict, true);
});
