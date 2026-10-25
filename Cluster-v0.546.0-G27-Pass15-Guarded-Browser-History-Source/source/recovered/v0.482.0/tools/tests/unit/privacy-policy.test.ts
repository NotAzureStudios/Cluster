import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePrivacyPolicyMarkdown,
  normalizePrivacyPolicyVersion,
  privacyPolicyContentHash,
  starterPrivacyPolicy,
} from "../../../apps/server/src/core/privacy-policy.js";

test("privacy policy versions use bounded numeric identifiers", () => {
  assert.equal(normalizePrivacyPolicyVersion(" 1.2.0 "), "1.2.0");
  assert.equal(normalizePrivacyPolicyVersion("2.0-beta.1"), "2.0-beta.1");
  assert.throws(() => normalizePrivacyPolicyVersion("latest"));
  assert.throws(() => normalizePrivacyPolicyVersion("1/../../2"));
});

test("privacy policy markdown is normalized before hashing", () => {
  assert.equal(normalizePrivacyPolicyMarkdown("# Policy\r\n\r\nText\r\n"), "# Policy\n\nText");
  const left = privacyPolicyContentHash({ version: "1.0", title: "Privacy Policy", summary: "Notice", bodyMarkdown: "# Policy\r\n\r\nText\r\n" });
  const right = privacyPolicyContentHash({ version: "1.0", title: "Privacy Policy", summary: "Notice", bodyMarkdown: "# Policy\n\nText" });
  assert.equal(left, right);
});

test("privacy policy content hash changes when legal content changes", () => {
  const base = { version: "1.0", title: "Privacy Policy", summary: "Notice", bodyMarkdown: "# Policy\n\nText" };
  const left = privacyPolicyContentHash(base);
  const right = privacyPolicyContentHash({ ...base, bodyMarkdown: "# Policy\n\nChanged text" });
  assert.notEqual(left, right);
  assert.match(left, /^[a-f0-9]{64}$/);
});

test("starter privacy policy remains an explicit review scaffold", () => {
  const starter = starterPrivacyPolicy("Duck Studio");
  assert.equal(starter.version, "1.0");
  assert.match(starter.bodyMarkdown, /Duck Studio/);
  assert.match(starter.bodyMarkdown, /\[PRIVACY CONTACT\]/);
  assert.match(starter.bodyMarkdown, /before publishing it/);
});
