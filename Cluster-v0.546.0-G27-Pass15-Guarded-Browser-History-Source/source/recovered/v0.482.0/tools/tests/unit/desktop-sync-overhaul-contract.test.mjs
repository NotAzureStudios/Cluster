import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("condensed roadmap Step 4 advances the native desktop broker without exposing paths", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const header = await read("apps/desktop-qt/src/NativeCapabilityBroker.h");
  const broker = await read("apps/desktop-qt/src/NativeCapabilityBroker.cpp");
  const integration = await read("apps/desktop-qt/src/DesktopIntegration.cpp");
  const bridge = await read("packages/renderer/src/core/desktop.ts");
  assert.equal(versions.cluster, "0.422.0");
  assert.match(header, /return 3;/);
  assert.match(broker, /watch\.start/);
  assert.match(broker, /clipboard\.writeText/);
  assert.match(broker, /rawFilesystemPathsExposed/);
  assert.doesNotMatch(broker, /clipboard\.read/);
  assert.match(integration, /Qt::BackButton/);
  assert.match(integration, /Qt::ForwardButton/);
  assert.match(bridge, /__clusterNativeEventDeliver/);
  assert.match(bridge, /startNativeFileWatch/);
});

test("condensed roadmap Step 4 makes sync and collaboration posture observable", async () => {
  const offline = await read("packages/renderer/src/core/offline-runtime.ts");
  const syncCenter = await read("packages/renderer/src/components/SyncStatusIndicator.tsx");
  const collaboration = await read("apps/server/src/core/collaboration-runtime.ts");
  const renderer = await read("packages/renderer/src/features/collaboration/index.tsx");
  const contracts = await read("packages/shared/src/api-contracts.ts");
  assert.match(offline, /refreshServerSyncPosture/);
  assert.match(offline, /serverOpenConflicts/);
  assert.match(syncCenter, /sync-center-metrics-v385/);
  assert.match(collaboration, /transportVersion: 2/);
  assert.match(collaboration, /fullStateFrames: true/);
  assert.match(renderer, /sequenceGaps/);
  assert.match(renderer, /recovered gap/);
  assert.match(contracts, /desktop-sync-overhaul-v2/);
  assert.match(contracts, /realtime-collaboration-v2/);
  assert.match(contracts, /2026-08-02\.62/);
});

test("desktop parity and desktop sync audits are release-blocking", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const packager = await read("tools/scripts/package-cluster-master.mjs");
  assert.match(pkg.scripts.audit, /desktop-parity-audit\.mjs/);
  assert.match(pkg.scripts.audit, /desktop-sync-audit\.mjs/);
  assert.equal(pkg.scripts["audit:desktop-parity"], "node tools/scripts/desktop-parity-audit.mjs");
  assert.equal(pkg.scripts["audit:desktop-sync"], "node tools/scripts/desktop-sync-audit.mjs");
  assert.match(packager, /desktop-parity-audit\.mjs/);
  assert.match(packager, /desktop-sync-audit\.mjs/);
  const parity = await execFileAsync(process.execPath, ["tools/scripts/desktop-parity-audit.mjs"], { cwd: root });
  const sync = await execFileAsync(process.execPath, ["tools/scripts/desktop-sync-audit.mjs"], { cwd: root });
  assert.match(parity.stdout, /Cluster desktop parity audit: \d+\/\d+ passed/);
  assert.doesNotMatch(parity.stdout, /^FAIL/m);
  assert.match(sync.stdout, /Cluster desktop & sync audit: \d+\/\d+ passed/);
  assert.doesNotMatch(sync.stdout, /^FAIL/m);
});

test("condensed roadmap Step 4 is documented and packaged", async () => {
  const docs = await read("docs/DESKTOP_SYNC_OVERHAUL.md");
  const notes = await read("RELEASE_NOTES_v0.385.0.md");
  const nativeDoc = await read("docs/NATIVE_CAPABILITY_BROKER.md");
  const changelog = await read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
  const packager = await read("tools/scripts/package-cluster-master.mjs");
  assert.match(docs, /Core Product & Architecture Roadmap Step 4 of 7/);
  assert.match(notes, /Core Product & Architecture Roadmap Step 4 of 7/);
  assert.match(nativeDoc, /protocol 2/);
  assert.match(changelog, /version: "v0\.385\.0"/);
  assert.ok((packager.match(/docs\/DESKTOP_SYNC_OVERHAUL\.md/g) || []).length >= 2);
});
