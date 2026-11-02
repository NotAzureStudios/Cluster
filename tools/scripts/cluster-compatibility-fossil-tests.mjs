import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
const source = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const qt = source("apps/desktop-qt/src/TransferManager.cpp");
const header = source("apps/desktop-qt/src/TransferManager.h");
const multiwindow = source("tools/scripts/cluster-g26-multiwindow-transfer-ownership-tests.mjs");
const packageClient = source("packages/renderer/src/features/settings/package-segment-download.ts");
const packageUI = source("packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx");

// No old AppDataLocation journal migration. Current profile root is authoritative.
for (const obsolete of ["legacyStoragePath", "migrateLegacy"]) {
  assert.doesNotMatch(qt, new RegExp(obsolete), obsolete + " must not be revived");
  assert.doesNotMatch(header, new RegExp(obsolete), obsolete + " declaration must be removed");
  assert.doesNotMatch(multiwindow, /migrateLegacy/, "obsolete historical test assertion must be updated");
}
assert.match(qt, /void TransferManager::load\(\)\s*\{[\s\S]*?const QString path = storagePath\(\);/,
  "load uses canonical, profile-scoped journal only");
assert.match(qt, /const QFileInfo queueInfo\(path\);[\s\S]*?if \(!m_queueReadable\) \{\s*m_transfers.clear\(\);/,
  "invalid current journal still blocks writes");
assert.match(qt, /bool TransferManager::save\(\) const\s*\{\s*if \(!ownsQueue\(\)\) return false;/,
  "standby must not write journal");
assert.match(qt, /m_scopeLock->setStaleLockTime\(0\)/,
  "current live transfer writer cannot be evicted based only on lock age");

// Do not remove a live feature simply because its code was called compatible.
assert.match(packageUI, /downloadPackageSegments\(/,
  "bounded Package in-memory transport remains an active caller");
assert.match(packageUI, /downloadPackageSegmentsToSink\(/,
  "native Package spool has a separate active caller");
assert.match(packageClient, /export async function downloadPackageSegmentsToSink\(/);
assert.match(packageClient, /export async function downloadPackageSegments\(/);
console.log("PASS: legacy Qt journal path retired, canonical safety guards intact, active Package transports preserved");

const databaseCommand = source("tools/scripts/database-command.mjs");
assert.doesNotMatch(databaseCommand, /recoverRc3MeetingOccurrenceMigration|migration-recovery\.mjs|migrate", "resolve"/,
  "database deploy must not run RC3-only migration repair");
const deployStart = databaseCommand.indexOf('} else if (["deploy", "release"].includes(action)) {');
assert.notEqual(deployStart, -1, "deploy and release must use the canonical Prisma workflow");
const deployEnd = databaseCommand.indexOf("} else {", deployStart);
assert.ok(deployEnd > deployStart, "the deploy branch must end normally");
const deployBranch = databaseCommand.slice(deployStart, deployEnd);
assert.match(deployBranch, /await requireMigrationHistory\(\);/,
  "deploy must still verify migration history");
assert.match(deployBranch, /await run\(process\.execPath, \[prismaCli, "migrate", "deploy", \.\.\.prismaArgs\]\);/,
  "deploy must call canonical Prisma migrate deploy");
for (const removed of ["tools/scripts/migration-recovery.mjs", "tools/scripts/cluster-rc4-migration-tests.mjs"]) {
  assert.equal(existsSync(new URL("../../" + removed, import.meta.url)), false, removed + " must be retired");
}
console.log("PASS: no RC3-only database recovery path remains in live startup");
