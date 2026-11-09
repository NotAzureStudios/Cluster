import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { sendStoredResource, sendStorageResource, parseSingleByteRange } from "../../apps/server/dist/domains/media/resource-delivery.js";

let checks = 0;
async function check(name, action) { await action(); checks++; console.log("PASS " + name); }
function mockReply() {
  return {
    status: 200, headers: {}, payload: undefined,
    code(status) { this.status = status; return this; },
    header(name, value) { this.headers[name.toLowerCase()] = String(value); return this; },
    send(payload) { this.payload = payload; return this; },
  };
}
const request = (method, headers = {}) => ({ method, headers });
async function streamBytes(reply) {
  if (!reply.payload || typeof reply.payload[Symbol.asyncIterator] !== "function") return Buffer.alloc(0);
  const chunks = [];
  for await (const chunk of reply.payload) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
const sample = Buffer.from(Array.from({ length: 512 * 1024 + 29 }, (_, i) => i % 251));
const sha256 = createHash("sha256").update(sample).digest("hex");
const modifiedAt = new Date("2026-10-15T12:00:00Z");
const common = {
  mimeType: "application/octet-stream", originalName: 'studio file "build".zip',
  requestedInline: false, checksumSha256: sha256,
  knownStat: { size: sample.length, modifiedAt },
};
const etag = '"sha256-' + sha256 + '"';
await check("single byte ranges reject malformed and out-of-bounds requests", () => {
  assert.deepEqual(parseSingleByteRange("bytes=0-99", sample.length), { start: 0, end: 99 });
  assert.deepEqual(parseSingleByteRange("bytes=-100", sample.length), { start: sample.length - 100, end: sample.length - 1 });
  assert.deepEqual(parseSingleByteRange("bytes=512-", sample.length), { start: 512, end: sample.length - 1 });
  assert.equal(parseSingleByteRange("bytes=0-20,50-70", sample.length), null);
  assert.equal(parseSingleByteRange("bytes=999999999-", sample.length), null);
});
await check("verified provider metadata prevents redundant HEAD and permits byte-accurate resume", async () => {
  let stats = 0, opens = 0, lastRange = null;
  const storage = {
    stat: async () => { stats++; return { size: sample.length, modifiedAt }; },
    openRead: async (_locator, range) => {
      opens++; lastRange = range;
      return Readable.from([range ? sample.subarray(range.start, range.end + 1) : sample]);
    },
  };
  const locator = { provider: "local", tier: "temporary", key: "uploads/studio/build" };
  const res = mockReply();
  await sendStorageResource(request("GET", { range: "bytes=1234-4321" }), res, { ...common, storage, locator });
  assert.equal(res.status, 206);
  assert.equal(res.headers["accept-ranges"], "bytes");
  assert.equal(res.headers["content-range"], "bytes 1234-4321/" + sample.length);
  assert.equal(res.headers["content-length"], "3088");
  assert.equal(res.headers["etag"], etag);
  assert.match(res.headers["content-disposition"], /^attachment;/);
  assert.deepEqual(lastRange, { start: 1234, end: 4321 });
  assert.equal(stats, 0, "download metadata was already verified");
  assert.equal(opens, 1);
  assert.deepEqual(await streamBytes(res), sample.subarray(1234, 4322));
});
await check("ETag 304 and HEAD responses never open provider body streams", async () => {
  let opens = 0;
  const storage = {
    stat: async () => { throw Error("duplicate provider HEAD"); },
    openRead: async () => { opens++; throw Error("must not read body"); },
  };
  const locator = { provider: "s3", tier: "temporary", key: "uploads/p1/build" };
  const conditional = mockReply();
  await sendStorageResource(request("GET", { "if-none-match": etag }), conditional, { ...common, storage, locator });
  assert.equal(conditional.status, 304);
  assert.equal(conditional.payload, undefined);
  const head = mockReply();
  await sendStorageResource(request("HEAD", { range: "bytes=32-63" }), head, { ...common, storage, locator });
  assert.equal(head.status, 206);
  assert.equal(head.headers["content-length"], "32");
  assert.equal(head.payload, undefined);
  assert.equal(opens, 0);
});
await check("invalid range 416 avoids body, stale If-Range transfers full content", async () => {
  const calls = [];
  const storage = {
    stat: async () => { throw Error("duplicate provider HEAD"); },
    openRead: async (_locator, range) => {
      calls.push(range);
      return Readable.from([range ? sample.subarray(range.start, range.end + 1) : sample]);
    },
  };
  const locator = { provider: "s3", tier: "temporary", key: "uploads/p1/build" };
  const invalid = mockReply();
  await sendStorageResource(request("GET", { range: "bytes=9999999999-9999999999" }), invalid, { ...common, storage, locator });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers["content-range"], "bytes */" + sample.length);
  assert.equal(calls.length, 0);
  const full = mockReply();
  await sendStorageResource(request("GET", { range: "bytes=100-200", "if-range": '"obsolete"' }), full, { ...common, storage, locator });
  assert.equal(full.status, 200);
  assert.equal(full.headers["content-length"], String(sample.length));
  assert.deepEqual(calls, [undefined]);
  assert.deepEqual(await streamBytes(full), sample);
});
await check("local disk download supports suffix ranges, HEAD and ETag reuse", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-download-range-"));
  const filePath = path.join(dir, "build.zip");
  try {
    await fs.writeFile(filePath, sample);
    const actual = await fs.stat(filePath);
    const local = { ...common, knownStat: { size: actual.size, modifiedAt: actual.mtime }, filePath };
    const range = mockReply();
    await sendStoredResource(request("GET", { range: "bytes=-37" }), range, local);
    assert.equal(range.status, 206);
    assert.equal(range.headers["content-length"], "37");
    assert.deepEqual(await streamBytes(range), sample.subarray(sample.length - 37));
    const head = mockReply();
    await sendStoredResource(request("HEAD"), head, local);
    assert.equal(head.status, 200);
    assert.equal(head.headers["content-length"], String(sample.length));
    assert.equal(head.payload, undefined);
    const conditional = mockReply();
    await sendStoredResource(request("GET", { "if-none-match": etag }), conditional, local);
    assert.equal(conditional.status, 304);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
await check("download route keeps owner verification before canonical stream", async () => {
  const source = await fs.readFile(new URL("../../apps/server/src/domains/uploads/upload-session-routes.ts", import.meta.url), "utf8");
  assert.match(source, /const upload = await resolveCompletedUpload\(deps, params\.uploadId, user\.id, Boolean\(user\.isAdmin\)\)/);
  assert.match(source, /sendStoredResource\(request, reply/);
  assert.match(source, /sendStorageResource\(request, reply/);
  assert.match(source, /knownStat: upload\.resourceStat/);
  assert.ok(!source.includes("reply.send(createReadStream(upload.filePath))"));
});
console.log(checks + "/" + checks + " completed upload streaming regressions passed");
