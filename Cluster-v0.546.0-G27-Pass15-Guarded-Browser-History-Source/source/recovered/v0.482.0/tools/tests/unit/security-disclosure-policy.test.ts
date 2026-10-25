import assert from "node:assert/strict";
import test from "node:test";
import {
  SECURITY_DISCLOSURE_POLICY_KIND,
  normalizeSecurityDisclosureMetadata,
  normalizeSecurityDisclosureVersion,
  securityDisclosureContentHash,
  securityTxtFromPolicy,
  starterSecurityDisclosurePolicy,
} from "../../../apps/server/src/core/security-disclosure-policy.js";

test("security disclosure versions use bounded numeric identifiers", () => {
  assert.equal(normalizeSecurityDisclosureVersion("1.0"), "1.0");
  assert.throws(() => normalizeSecurityDisclosureVersion("release-next"), /numeric version/);
});

test("security.txt metadata requires a current bounded contact and expiry", () => {
  const now = new Date("2026-08-20T00:00:00.000Z");
  const normalized = normalizeSecurityDisclosureMetadata({
    contacts: ["mailto:security@example.com", "https://example.com/security/report"],
    expires: "2027-02-01T00:00:00.000Z",
    preferredLanguages: ["en", "fr"],
  }, { now, effectiveAt: now });
  assert.equal(normalized.contacts.length, 2);
  assert.deepEqual(normalized.preferredLanguages, ["en", "fr"]);
  assert.throws(() => normalizeSecurityDisclosureMetadata({ contacts: [], expires: "2027-02-01T00:00:00.000Z" }, { now }), /contact is required/);
  assert.throws(() => normalizeSecurityDisclosureMetadata({ contacts: ["mailto:security@example.com"], expires: "2028-01-01T00:00:00.000Z" }, { now }), /within 366 days/);
});

test("security disclosure hash binds policy text and security.txt metadata", () => {
  const metadata = normalizeSecurityDisclosureMetadata({ contacts: ["mailto:security@example.com"], expires: "2027-02-01T00:00:00.000Z", preferredLanguages: ["en"] }, { now: new Date("2026-08-20T00:00:00.000Z") });
  const first = securityDisclosureContentHash({ version: "1.0", title: "Security Policy", bodyMarkdown: "# Security", metadata });
  const second = securityDisclosureContentHash({ version: "1.0", title: "Security Policy", bodyMarkdown: "# Security changed", metadata });
  assert.notEqual(first, second);
});

test("security.txt is generated from the effective published policy metadata", () => {
  const metadata = normalizeSecurityDisclosureMetadata({ contacts: ["mailto:security@example.com"], expires: "2027-02-01T00:00:00.000Z", preferredLanguages: ["en"] }, { now: new Date("2026-08-20T00:00:00.000Z") });
  const body = securityTxtFromPolicy({
    id: "policy-1", kind: SECURITY_DISCLOSURE_POLICY_KIND, version: "1.0", title: "Security Policy", bodyMarkdown: "# Security",
    metadataJson: JSON.stringify(metadata), contentHash: "hash", status: "published", createdAt: new Date(), updatedAt: new Date(),
  }, "https://cluster.example.com");
  assert.match(body, /Contact: mailto:security@example\.com/);
  assert.match(body, /Expires: 2027-02-01T00:00:00\.000Z/);
  assert.match(body, /Policy: https:\/\/cluster\.example\.com\/legal\/security/);
  assert.match(body, /Canonical: https:\/\/cluster\.example\.com\/\.well-known\/security\.txt/);
});

test("starter policy is cautious scaffolding rather than bug-bounty authorization", () => {
  const starter = starterSecurityDisclosurePolicy("Example Studio", new Date("2026-08-20T00:00:00.000Z"));
  assert.match(starter.bodyMarkdown, /not legal advice/i);
  assert.match(starter.bodyMarkdown, /does not create a bug bounty/i);
  assert.match(starter.bodyMarkdown, /GOOD-FAITH|good-faith/i);
  assert.equal(starter.metadata.contacts[0], "mailto:security@example.com");
});
