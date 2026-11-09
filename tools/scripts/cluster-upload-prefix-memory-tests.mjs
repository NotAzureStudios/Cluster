import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readCompletedUploadPrefix } from "../../apps/server/dist/domains/uploads/upload-session-runtime.js";

let checks = 0;
async function check(label, fn) { await fn(); checks++; console.log("PASS " + label); }
const storage = { provider: "s3", tier: "temporary", key: "test/studio-upload" };
function upload(totalBytes, filePath = null) {
  return {
    metadata: { id: "00000000-0000-4000-8000-000000000001", totalBytes },
    filePath, storage: filePath ? null : storage,
  };
}
function harness(openRead) {
  const calls = [];
  return {
    calls,
    deps: { storageRuntime: { openRead: async (_locator, range) => {
      calls.push(range);
      return openRead(range);
    } } },
  };
}

await check("oversized remote provider chunks never expand retained preview prefix", async () => {
  const huge = Buffer.alloc(2 * 1024 * 1024, 0x64);
  huge[0] = 0x42;
  const stream = Readable.from([huge, Buffer.alloc(2 * 1024 * 1024, 0x99)]);
  const { deps, calls } = harness(() => stream);
  const prefix = await readCompletedUploadPrefix(deps, upload(20 * 1024 * 1024), 64 * 1024);
  assert.equal(prefix.length, 64 * 1024);
  assert.equal(prefix[0], 0x42);
  assert.equal(prefix[prefix.length - 1], 0x64);
  assert.deepEqual(calls, [{ start: 0, end: 64 * 1024 - 1 }]);
  assert.equal(stream.destroyed, true, "reader must stop the provider once the prefix is complete");
});
await check("multiple short provider chunks fill exact prefix, preserving byte order", async () => {
  const stream = Readable.from([
    Buffer.from("AB"), new Uint8Array(Buffer.from("CDE")), Buffer.from("FGHIJ"),
  ]);
  const { deps } = harness(() => stream);
  assert.equal((await readCompletedUploadPrefix(deps, upload(300), 7)).toString(), "ABCDEFG");
  assert.equal(stream.destroyed, true);
});
await check("short providers return only actual bytes received", async () => {
  const { deps } = harness(() => Readable.from([Buffer.from("tiny")]));
  const prefix = await readCompletedUploadPrefix(deps, upload(300), 7);
  assert.equal(prefix.toString(), "tiny");
  assert.equal(prefix.length, 4);
});
await check("zero-length completed uploads do not open provider range at all", async () => {
  const { deps, calls } = harness(() => { throw Error("empty file must not open provider"); });
  const prefix = await readCompletedUploadPrefix(deps, upload(0));
  assert.equal(prefix.length, 0);
  assert.equal(calls.length, 0);
});
await check("prefix range never extends past known object size", async () => {
  const { deps, calls } = harness(() => Readable.from([Buffer.from("small")]));
  const bytes = await readCompletedUploadPrefix(deps, upload(5), 64 * 1024);
  assert.equal(bytes.toString(), "small");
  assert.deepEqual(calls, [{ start: 0, end: 4 }]);
});
await check("invalid and zero-length preview maximum never open remote provider", async () => {
  const { deps, calls } = harness(() => { throw Error("invalid prefix must not be requested"); });
  for (const maximum of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const prefix = await readCompletedUploadPrefix(deps, upload(100), maximum);
    assert.equal(prefix.length, 0);
  }
  assert.equal(calls.length, 0);
});
await check("storage I/O errors propagate rather than publishing an incomplete authoritative preview", async () => {
  const source = Readable.from((async function* () {
    yield Buffer.from("partial");
    throw new Error("provider read failed");
  })());
  const { deps } = harness(() => source);
  await assert.rejects(readCompletedUploadPrefix(deps, upload(300), 100), /provider read failed/);
  assert.equal(source.destroyed, true);
});
console.log(checks + "/" + checks + " completed upload prefix memory tests passed");
