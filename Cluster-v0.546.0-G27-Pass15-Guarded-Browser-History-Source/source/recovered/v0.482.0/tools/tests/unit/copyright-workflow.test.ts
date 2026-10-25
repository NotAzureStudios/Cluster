import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addBusinessDays,
  copyrightNoticeHash,
  generateCopyrightCaseReference,
  generateCopyrightCaseToken,
  hashCopyrightCaseToken,
  sanitizeCopyrightEventMetadata,
  writeCopyrightEvidence,
} from "../../../apps/server/src/core/copyright-workflow.js";

test("copyright case references and private access tokens are opaque", () => {
  const reference = generateCopyrightCaseReference(new Date("2026-08-19T12:00:00Z"));
  const token = generateCopyrightCaseToken();
  assert.match(reference, /^CR-20260819-[A-F0-9]{10}$/);
  assert.ok(token.length >= 40);
  assert.match(hashCopyrightCaseToken(token), /^[a-f0-9]{64}$/);
  assert.notEqual(hashCopyrightCaseToken(token), hashCopyrightCaseToken(`${token}x`));
});

test("notice hashes are canonical and content bound", () => {
  const left = copyrightNoticeHash({ reporter: "A", work: "Example", nested: { b: 2, a: 1 } });
  const same = copyrightNoticeHash({ nested: { a: 1, b: 2 }, work: "Example", reporter: "A" });
  const changed = copyrightNoticeHash({ nested: { a: 1, b: 2 }, work: "Changed", reporter: "A" });
  assert.equal(left, same);
  assert.notEqual(left, changed);
});

test("counter-notice restoration windows count business days", () => {
  const friday = new Date("2026-08-21T16:00:00Z");
  assert.equal(addBusinessDays(friday, 1).toISOString(), "2026-08-24T16:00:00.000Z");
  assert.equal(addBusinessDays(friday, 10).toISOString(), "2026-09-04T16:00:00.000Z");
  assert.equal(addBusinessDays(friday, 14).toISOString(), "2026-09-11T16:00:00.000Z"); // Labor Day is excluded.
});

test("copyright evidence is bounded and stored outside user filenames", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-copyright-"));
  try {
    const results = await writeCopyrightEvidence({ uploadsRoot: root, caseId: "case-1", entries: [{ originalName: "../../claim.txt", dataUrl: `data:text/plain;base64,${Buffer.from("supporting evidence").toString("base64")}` }] });
    assert.equal(results.length, 1);
    assert.equal(results[0].mimeType, "text/plain");
    assert.ok(!results[0].storedName.includes("claim"));
    const stat = await fs.stat(path.join(root, "copyright-cases", "case-1", results[0].storedName));
    assert.equal(stat.size, Buffer.byteLength("supporting evidence"));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("security event metadata drops copyright submitter secrets", () => {
  const parsed = JSON.parse(sanitizeCopyrightEventMetadata({ caseId: "c1", reporterEmail: "person@example.com", signatureText: "Person", token: "secret", count: 2 }));
  assert.deepEqual(parsed, { caseId: "c1", count: 2 });
});
