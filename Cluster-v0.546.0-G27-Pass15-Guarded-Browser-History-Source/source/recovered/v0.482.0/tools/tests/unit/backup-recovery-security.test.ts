import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { signBackupManifest, verifyBackupManifestSignature } from "../../../apps/server/src/core/backup-manifest.js";
import { createFilesystemBackup, drillFilesystemRestore, verifyFilesystemBackup } from "../../../apps/server/src/core/filesystem-backup.js";
import { configurePostgresqlRuntime } from "../../../apps/server/src/core/postgresql-runtime.js";

const OLD_KEY = "cluster-backup-old-key-material-that-is-long-enough-0001";
const NEW_KEY = "cluster-backup-new-key-material-that-is-long-enough-0002";

async function withTempDirectory<T>(operation: (root: string) => Promise<T>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-backup-test-"));
  try { return await operation(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

test("filesystem backup archives and restores regular files without path loss", async () => {
  await withTempDirectory(async (root) => {
    const source = path.join(root, "source");
    const archive = path.join(root, "uploads.tar");
    const restore = path.join(root, "restore");
    await fs.mkdir(path.join(source, "project-a", "nested"), { recursive: true });
    await fs.writeFile(path.join(source, "project-a", "hello.txt"), "hello cluster\n");
    await fs.writeFile(path.join(source, "project-a", "nested", "blob.bin"), Buffer.from([0, 1, 2, 3, 4, 255]));

    const created = await createFilesystemBackup(source, archive);
    assert.equal(created.files, 2);
    assert.equal(created.bytes, Buffer.byteLength("hello cluster\n") + 6);

    const verified = await verifyFilesystemBackup(archive, created);
    assert.equal(verified.ok, true);
    assert.equal(verified.sha256, created.sha256);

    const drill = await drillFilesystemRestore(archive, restore, created);
    assert.equal(drill.ok, true);
    assert.equal(await fs.readFile(path.join(restore, "project-a", "hello.txt"), "utf8"), "hello cluster\n");
    assert.deepEqual([...await fs.readFile(path.join(restore, "project-a", "nested", "blob.bin"))], [0, 1, 2, 3, 4, 255]);
  });
});

test("filesystem backup refuses symbolic links", async (t) => {
  await withTempDirectory(async (root) => {
    const source = path.join(root, "source");
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(root, "outside.txt"), "outside");
    try {
      await fs.symlink(path.join(root, "outside.txt"), path.join(source, "linked.txt"));
    } catch {
      t.skip("symbolic links are unavailable in this environment");
      return;
    }
    await assert.rejects(createFilesystemBackup(source, path.join(root, "uploads.tar")), /symbolic link/i);
  });
});

test("filesystem archive tampering is detected before restore", async () => {
  await withTempDirectory(async (root) => {
    const source = path.join(root, "source");
    const archive = path.join(root, "uploads.tar");
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, "payload.txt"), "safe payload");
    const created = await createFilesystemBackup(source, archive);
    const handle = await fs.open(archive, "r+");
    try {
      const changed = Buffer.from([0x7f]);
      await handle.write(changed, 0, 1, 0);
    } finally {
      await handle.close();
    }
    await assert.rejects(verifyFilesystemBackup(archive, created), /checksum|archive path|ustar/i);
  });
});

test("signed backup manifests detect tampering and survive key rotation", () => {
  const oldEnv = { NODE_ENV: "production", CLUSTER_SECRET_KEY: OLD_KEY } as NodeJS.ProcessEnv;
  const rotatedEnv = { NODE_ENV: "production", CLUSTER_SECRET_KEY: NEW_KEY, CLUSTER_SECRET_KEY_PREVIOUS: OLD_KEY } as NodeJS.ProcessEnv;
  const manifest = signBackupManifest({ schemaVersion: 2, generationId: "g1", files: { database: { sha256: "abc" } } }, oldEnv);
  assert.equal(verifyBackupManifestSignature(manifest, oldEnv), true);
  assert.equal(verifyBackupManifestSignature(manifest, rotatedEnv), true);
  const tampered = { ...manifest, generationId: "g2" };
  assert.equal(verifyBackupManifestSignature(tampered, rotatedEnv), false);
});

test("server startup refuses a PostgreSQL recovery replica", async () => {
  const prisma = {
    async $queryRawUnsafe() {
      return [{ version_num: 170010, timezone: "UTC", recovery: true }];
    },
  };
  const logger = { info() {}, warn() {} };
  await assert.rejects(configurePostgresqlRuntime(prisma, "postgresql://cluster:secret@127.0.0.1:5432/cluster", logger), /writable PostgreSQL primary/i);
});
