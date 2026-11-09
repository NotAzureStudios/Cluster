import assert from "node:assert/strict";
import Fastify from "fastify";
import { Readable } from "node:stream";
import { createBufferedUploadAdmission, bufferedUploadAdmissionLimit, preflightBufferedChunkHeaders } from "../../apps/server/dist/domains/uploads/upload-chunk-admission.js";
import { registerUploadSessionRoutes } from "../../apps/server/dist/domains/uploads/upload-session-routes.js";

let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log("PASS " + name); }
const MAX = 8 * 1024 * 1024;
await check("valid chunks pass preflight; oversized, malformed, dishonest lengths are refused", () => {
  const valid = preflightBufferedChunkHeaders({ "content-range": "bytes 0-1023/1024", "content-length": "1024" }, MAX);
  assert.deepEqual(valid, { ok: true, range: { start: 0, end: 1023, total: 1024, bytes: 1024 } });
  assert.equal(preflightBufferedChunkHeaders({ "content-range": "bytes 0-1023/1024" }, MAX).ok, true);
  const invalid = [
    { h: {}, status: 400 }, { h: { "content-range": "bytes 0-10/10" }, status: 400 },
    { h: { "content-range": "bytes 0-0/1", "content-length": "100" }, status: 400 },
    { h: { "content-range": "bytes 0-0/1", "content-length": "-1" }, status: 400 },
    { h: { "content-range": "bytes 0-9007199254740992/9007199254740993" }, status: 400 },
    { h: { "content-range": "bytes 0-8388608/8388609" }, status: 413 },
    { h: { "content-range": "bytes 100-50/100" }, status: 400 },
  ];
  for (const {h,status} of invalid) assert.equal(preflightBufferedChunkHeaders(h,MAX).status,status,JSON.stringify(h));
});
await check("bounded chunk memory admits only fixed concurrency with idempotent release", () => {
  const gate = createBufferedUploadAdmission(2);
  const first = gate.acquire(), second = gate.acquire();
  assert.equal(typeof first, "function");
  assert.equal(typeof second, "function");
  assert.equal(gate.acquire(), null);
  assert.deepEqual(gate.snapshot(), { active: 2, limit: 2, rejected: 1 });
  first(); first();
  assert.equal(gate.snapshot().active, 1);
  const third = gate.acquire();
  assert.equal(typeof third, "function");
  second();third();
  assert.equal(gate.snapshot().active, 0);
  assert.equal(bufferedUploadAdmissionLimit(100),16);
  assert.equal(bufferedUploadAdmissionLimit(-5),1);
});

function admissionApp({ user = true, mode = "cluster", byteLimit } = {}) {
  const app = Fastify({ logger: false });
  let sessionReads = 0, byteReads = 0;
  const session = {
    id: "00000000-0000-4000-8000-000000000001", ownerId: "owner", workspaceId: "studio",
    totalBytes: 1n, receivedBytes: 0n, status: "OPEN", mode,
  };
  registerUploadSessionRoutes({
    app,
    getCurrentUser: async () => user ? { id: "owner", isAdmin: false } : null,
    decorateUserForClient: async u => u,
    byteRateLimiter: {
      consumeCost: async (...args) => { byteReads++; return byteLimit ? byteLimit(...args) : { allowed: true, retryAfterSeconds: 0 }; },
    },
    prisma: { uploadSession: { findUnique: async () => { sessionReads++; return session; } } },
    dataLayout: { root: "/nonexistent/cluster", runtimeRoot: "/nonexistent/cluster" },
    storageRuntime: { directUploadTarget: () => null },
  });
  return { app, get sessionReads() { return sessionReads; }, get byteReads() { return byteReads; }, session };
}
const chunkUrl = "/api/uploads/00000000-0000-4000-8000-000000000001/chunks";
const headers = {
  "content-type": "application/octet-stream",
  "content-range": "bytes 0-0/1",
};
await check("Fastify rejects unauthenticated and invalid chunk requests before byte budgeting", async () => {
  const denied = admissionApp({ user: false });
  try {
    const response = await denied.app.inject({method:"PUT",url:chunkUrl,headers,payload:Buffer.from("x")});
    assert.equal(response.statusCode,401);
    assert.equal(denied.sessionReads,0);
    assert.equal(denied.byteReads,0);
  } finally { await denied.app.close(); }
  const invalid = admissionApp();
  try {
    const response = await invalid.app.inject({ method:"PUT",url:chunkUrl,
      headers:{...headers,"content-range":"bytes 0-8388608/8388609"},payload:Buffer.from("x") });
    assert.equal(response.statusCode,413);
    assert.equal(invalid.sessionReads,1);
    assert.equal(invalid.byteReads,0);
  } finally { await invalid.app.close(); }
});
await check("Fastify bounds simultaneous buffered uploads before reading body; releasing permits admits new requests", async () => {
  const previous = process.env.CLUSTER_UPLOAD_BUFFERED_CHUNKS_MAX;
  process.env.CLUSTER_UPLOAD_BUFFERED_CHUNKS_MAX="1";
  let finishBudget;
  const heldBudget = new Promise(resolve => { finishBudget=resolve; });
  let calls=0;
  const ctx=admissionApp({ byteLimit:async()=>{ calls++; if(calls===1) await heldBudget; return {allowed:true,retryAfterSeconds:0}; } });
  try {
    const first=ctx.app.inject({method:"PUT",url:chunkUrl,headers,payload:Buffer.from("x")});
    for(let i=0;i<100 && calls<1;i++) await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls,1,"first request must hold the upload permit");
    const denied=await ctx.app.inject({method:"PUT",url:chunkUrl,headers,payload:Buffer.from("x")});
    assert.equal(denied.statusCode,503);
    assert.equal(denied.headers["retry-after"],"1");
    assert.equal(JSON.parse(denied.body).code,"UPLOAD_CHUNK_ADMISSION_BUSY");
    assert.equal(calls,1,"over-limit requests must not trigger byte-budget queries");
    finishBudget();
    await first;
    const third=await ctx.app.inject({method:"PUT",url:chunkUrl,headers,payload:Buffer.from("x")});
    assert.notEqual(third.statusCode,503,"permit is released at request completion");
    assert.equal(calls,2);
  } finally {
    finishBudget();
    await ctx.app.close();
    if(previous===undefined)delete process.env.CLUSTER_UPLOAD_BUFFERED_CHUNKS_MAX;
    else process.env.CLUSTER_UPLOAD_BUFFERED_CHUNKS_MAX=previous;
  }
});
await check("chunked body larger than its claimed range is rejected and fully rate-budgeted", async () => {
  const charged = [];
  const ctx = admissionApp({ byteLimit: async (_key,_max,_window,bytes) => {
    charged.push(bytes);
    return {allowed:true,retryAfterSeconds:0};
  } });
  try {
    const result = await ctx.app.inject({
      method:"PUT", url:chunkUrl,
      headers:{...headers,"transfer-encoding":"chunked"},
      payload: Readable.from([Buffer.from("xx")]),
    });
    assert.equal(result.statusCode,400);
    assert.equal(JSON.parse(result.body).code,"UPLOAD_RANGE_INVALID");
    assert.deepEqual(charged,[1,1],"overflow bytes cannot evade workspace rate accounting");
  } finally { await ctx.app.close(); }
});
console.log(checks + "/" + checks + " buffered chunk upload admission tests passed");
