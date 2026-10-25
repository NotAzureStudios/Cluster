import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { classifyOutboundAddress, secureOutboundFetch, validateOutboundUrl } from "../../../apps/server/src/core/outbound-http.js";

test("outbound address classification blocks local metadata and requires opt-in for private networks", () => {
  assert.equal(classifyOutboundAddress("127.0.0.1").privateNetwork, true);
  assert.equal(classifyOutboundAddress("10.20.30.40").privateNetwork, true);
  assert.equal(classifyOutboundAddress("169.254.169.254").alwaysBlocked, true);
  assert.equal(classifyOutboundAddress("::1").privateNetwork, true);
  assert.equal(classifyOutboundAddress("fe80::1").alwaysBlocked, true);
  assert.equal(classifyOutboundAddress("8.8.8.8").privateNetwork, false);
});

test("outbound URL validation rejects credentials, disallowed protocols, and non-allowlisted hosts", () => {
  assert.throws(() => validateOutboundUrl("file:///etc/passwd", { purpose: "test" }), /HTTP or HTTPS/);
  assert.throws(() => validateOutboundUrl("https://user:pass@example.com/", { purpose: "test" }), /embedded credentials/);
  assert.throws(() => validateOutboundUrl("https://example.net/", { purpose: "test", allowedHosts: ["example.com"] }), /not allowlisted/);
  assert.equal(validateOutboundUrl("https://example.com/path", { requireHttps: true, allowedHosts: ["example.com"] }).hostname, "example.com");
});

test("secure outbound fetch is pinned, bounded, redirect-safe, and private-network opt-in", async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === "/redirect") {
      response.statusCode = 302;
      response.setHeader("Location", "/ok");
      response.end();
      return;
    }
    if (request.url === "/cross-origin") {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      response.statusCode = 302;
      response.setHeader("Location", `http://localhost:${port}/ok`);
      response.end();
      return;
    }
    if (request.url === "/large") {
      response.end("x".repeat(128));
      return;
    }
    if (request.method === "POST") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => response.end(Buffer.concat(chunks)));
      return;
    }
    response.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;

  await assert.rejects(() => secureOutboundFetch(`${base}/ok`, {}, 2_000), /requires HTTPS/);
  const policy = { purpose: "test", allowPrivateNetwork: true, allowHttpPrivateNetwork: true, maxResponseBytes: 1024 };
  const direct = await secureOutboundFetch(`${base}/ok`, {}, 2_000, policy);
  assert.equal(await direct.text(), "ok");
  const redirected = await secureOutboundFetch(`${base}/redirect`, {}, 2_000, policy);
  assert.equal(await redirected.text(), "ok");
  await assert.rejects(() => secureOutboundFetch(`${base}/cross-origin`, {}, 2_000, policy), /cross-origin redirect/);
  await assert.rejects(() => secureOutboundFetch(`${base}/large`, {}, 2_000, { ...policy, maxResponseBytes: 32 }), /exceeds the 32-byte limit/);
  const posted = await secureOutboundFetch(`${base}/echo`, { method: "POST", body: new URLSearchParams({ hello: "world" }) }, 2_000, policy);
  assert.equal(await posted.text(), "hello=world");
});
