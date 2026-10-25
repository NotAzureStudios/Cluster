import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => readFile(path.join(root, relative), "utf8");
async function rendererFiles(directory = "packages/renderer/src") {
  const absolute = path.join(root, directory);
  const out = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await rendererFiles(relative));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(relative);
  }
  return out;
}

test("v0.389 eliminates native browser dialogs and implicit button semantics", async () => {
  const baseline = JSON.parse(await read("config/ux-debt-baseline.json"));
  assert.equal(baseline.nativeDialogCallsMaximum, 0);
  assert.equal(baseline.buttonWithoutExplicitTypeMaximum, 0);
  let source = "";
  for (const relative of await rendererFiles()) source += `\n${await read(relative)}`;
  assert.doesNotMatch(source, /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
  for (const match of source.matchAll(/<button\b[^>]*>/g)) assert.match(match[0], /\btype\s*=/);
});

test("v0.389 routes confirmations through the shared Cluster dialog host", async () => {
  const app = await read("packages/renderer/src/App.tsx");
  const host = await read("packages/renderer/src/components/ClusterDialogHost.tsx");
  const service = await read("packages/renderer/src/components/cluster-dialog-service.ts");
  const notes = await read("RELEASE_NOTES_v0.389.0.md");
  assert.match(app, /ClusterDialogHost/);
  assert.match(host, /role="dialog"/);
  assert.match(host, /expectedValue/);
  assert.match(service, /confirmCluster/);
  assert.match(service, /promptCluster/);
  assert.match(notes, /1,042 to zero/);
});
