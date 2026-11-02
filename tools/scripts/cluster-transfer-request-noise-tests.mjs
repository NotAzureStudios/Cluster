import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = (path) => readFileSync(path, "utf8");
const load = async (code) => import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

const { BoundedWarningGate } = await load(stripTypeScriptTypes(source("apps/server/src/core/bounded-warning-gate.ts"), { mode: "strip" }));
{
  const gate = new BoundedWarningGate(1_000, 2);
  assert.deepEqual(gate.check("route-a", 100), { emit: true, suppressedRepeats: 0 });
  assert.equal(gate.check("route-a", 200).emit, false);
  assert.equal(gate.check("route-a", 300).suppressedRepeats, 2);
  assert.deepEqual(gate.check("route-a", 1_100), { emit: true, suppressedRepeats: 2 });
  gate.check("route-b", 1_100);
  gate.check("route-c", 1_100);
  assert.equal(gate.size, 2, "diagnostic key cardinality must be bounded");
  assert.equal(gate.check("route-a", 1_200).emit, true, "evicted warning key can be emitted again");
}
const infra = source("apps/server/src/app/server-request-infrastructure.ts");
const allow = infra.match(/allowedHeaders:\s*\[([\s\S]*?)\]/)?.[1] || "";
const expose = infra.match(/exposedHeaders:\s*\[([\s\S]*?)\]/)?.[1] || "";
for (const header of ["Content-Range", "If-Range", "Range"]) {
  assert.ok(allow.includes('"' + header + '"'), header + " must be accepted by authenticated API CORS");
}
for (const header of ["Content-Range", "Content-Length", "Content-Disposition", "ETag", "Retry-After"]) {
  assert.ok(expose.includes('"' + header + '"'), header + " must be visible to the browser download client");
}
assert.match(infra, /requestWarningGate\.check\(`api-limit:/);
assert.match(infra, /requestWarningGate\.check\(`read-query:/);
const notificationSource = source("packages/renderer/src/features/notifications/desktop-notification-sync.ts");
assert.match(notificationSource, /Date\.now\(\) < nextAllowedPollAt/);
assert.match(notificationSource, /consecutivePollFailures/);
assert.match(notificationSource, /MIN_RECOVERY_POLL_GAP_MS/);

const original = {
  document: globalThis.document,
  window: globalThis.window,
  create: URL.createObjectURL,
  revoke: URL.revokeObjectURL,
};
let owner = "account-a";
let responseFactory = () => new Response(new Uint8Array([1,2,3]), {
  headers: { "content-type": "application/octet-stream", "content-length": "3" },
});
let clicked = 0;
let createdBlobs = 0;
globalThis.__mockTransfers = {
  clusterApiFetch: async () => responseFactory(),
  API_URL: "http://localhost:4000",
  getOfflineScopeIdentity: () => ({ scope: owner }),
  subscribeOfflineStorage: () => () => {},
  sameOfflineRequestContext: (a, b) => a.scope === b.scope,
  downloadWithVerifiedResume: async () => { throw Error("Not used in buffered tests"); },
  browserDiskTransferQueue: { setLimit() {} },
  browserDownloadByteLimiter: { async wait() {} },
  getTransferPolicy: () => ({ concurrentDiskDownloads: 2 }),
};
globalThis.document = {
  body: { append(node) { node.mounted = true; } },
  createElement() { return { mounted: false, click() { assert.ok(this.mounted); clicked++; }, remove() { this.mounted = false; } }; },
};
globalThis.window = {
  location: { origin: "http://localhost:4000" },
  setTimeout: () => 1,
  clearTimeout() {},
};
URL.createObjectURL = () => { createdBlobs++; return "blob:cluster-" + createdBlobs; };
URL.revokeObjectURL = () => {};
try {
  const stripped = source("packages/renderer/src/core/browser-download-transfers.ts")
    .replaceAll(/^import .*?;\r?\n/gm, "");
  const code = "const { clusterApiFetch, API_URL, getOfflineScopeIdentity, subscribeOfflineStorage, sameOfflineRequestContext, downloadWithVerifiedResume, browserDiskTransferQueue, browserDownloadByteLimiter, getTransferPolicy } = globalThis.__mockTransfers;\n" +
    stripTypeScriptTypes(stripped, { mode: "strip" });
  const { downloadAuthenticatedClusterFile } = await load(code);
  const url = "http://localhost:4000/api/library/file/download";
  assert.equal((await downloadAuthenticatedClusterFile({ url, fileName: "ok.bin", sizeBytes: 3 })).state, "saved");
  assert.equal(clicked, 1);
  responseFactory = () => new Response(new Uint8Array([1,2,3]), {
    headers: { "content-type": "application/octet-stream", "content-length": "4" },
  });
  await assert.rejects(downloadAuthenticatedClusterFile({ url, fileName: "truncated.bin" }), /Download incomplete/);
  assert.equal(clicked, 1, "truncated download must never open a save dialog");
  responseFactory = () => new Response(new Uint8Array([1,2,3]), {
    headers: { "content-type": "application/octet-stream", "content-length": "3" },
  });
  await assert.rejects(downloadAuthenticatedClusterFile({ url, fileName: "metadata.bin", sizeBytes: 2 }), /Download incomplete/);
  assert.equal(clicked, 1, "wrong file metadata must never produce a save");
  responseFactory = () => new Response('{"message":"Unauthorized"}', {
    headers: { "content-type": "application/problem+json" },
  });
  await assert.rejects(downloadAuthenticatedClusterFile({ url, fileName: "error.json" }), /incomplete or redirected/);
  assert.equal(clicked, 1, "problem+json masquerading as 200 cannot be downloaded");
  responseFactory = () => { owner = "account-b"; return new Response(new Uint8Array([1,2,3]), {
    headers: { "content-type": "application/octet-stream", "content-length": "3" },
  }); };
  await assert.rejects(downloadAuthenticatedClusterFile({ url, fileName: "stale.bin" }), /Account or server changed/);
  assert.equal(clicked, 1, "an old account's response cannot create a saved file");
} finally {
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
  globalThis.document = original.document;
  globalThis.window = original.window;
  delete globalThis.__mockTransfers;
}
console.log("PASS: upload CORS, resumable headers, bounded diagnostics, and safe buffered download outcomes");
