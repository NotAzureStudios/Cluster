import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTermsPolicyMarkdown,
  normalizeTermsPolicyVersion,
  starterTermsPolicy,
  termsPolicyContentHash,
} from "../../../apps/server/src/core/terms-policy.js";

test("terms versions use bounded numeric identifiers", () => {
  assert.equal(normalizeTermsPolicyVersion(" 1.2.0 "), "1.2.0");
  assert.equal(normalizeTermsPolicyVersion("2.0-beta.1"), "2.0-beta.1");
  assert.throws(() => normalizeTermsPolicyVersion("latest"));
  assert.throws(() => normalizeTermsPolicyVersion("1/../../2"));
});

test("terms markdown is normalized before hashing", () => {
  assert.equal(normalizeTermsPolicyMarkdown("# Terms\r\n\r\nText\r\n"), "# Terms\n\nText");
  const left = termsPolicyContentHash({ version: "1.0", title: "Terms of Service", summary: "Rules", bodyMarkdown: "# Terms\r\n\r\nText\r\n" });
  const right = termsPolicyContentHash({ version: "1.0", title: "Terms of Service", summary: "Rules", bodyMarkdown: "# Terms\n\nText" });
  assert.equal(left, right);
});

test("terms hash is kind-bound and changes when content changes", () => {
  const base = { version: "1.0", title: "Terms of Service", summary: "Rules", bodyMarkdown: "# Terms\n\nText" };
  const left = termsPolicyContentHash(base);
  const right = termsPolicyContentHash({ ...base, bodyMarkdown: "# Terms\n\nChanged text" });
  assert.notEqual(left, right);
  assert.match(left, /^[a-f0-9]{64}$/);
});

test("starter terms are an explicit legal-review scaffold", () => {
  const starter = starterTermsPolicy("Duck Studio");
  assert.equal(starter.version, "1.0");
  assert.match(starter.bodyMarkdown, /Duck Studio/);
  assert.match(starter.bodyMarkdown, /\[LEGAL REVIEW REQUIRED\]/);
  assert.match(starter.bodyMarkdown, /does not automatically publish or require acceptance/i);
  assert.match(starter.bodyMarkdown, /Do not claim ownership/i);
});
