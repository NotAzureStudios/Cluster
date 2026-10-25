import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCopyrightPolicyMarkdown,
  normalizeCopyrightPolicyVersion,
  starterCopyrightPolicy,
  copyrightPolicyContentHash,
} from "../../../apps/server/src/core/copyright-policy.js";

test("copyright policy versions use bounded numeric identifiers", () => {
  assert.equal(normalizeCopyrightPolicyVersion(" 1.2.0 "), "1.2.0");
  assert.equal(normalizeCopyrightPolicyVersion("2.0-beta.1"), "2.0-beta.1");
  assert.throws(() => normalizeCopyrightPolicyVersion("latest"));
  assert.throws(() => normalizeCopyrightPolicyVersion("1/../../2"));
});

test("copyright policy markdown is normalized before hashing", () => {
  assert.equal(normalizeCopyrightPolicyMarkdown("# Copyright\r\n\r\nText\r\n"), "# Copyright\n\nText");
  const left = copyrightPolicyContentHash({ version: "1.0", title: "Copyright & DMCA Policy", summary: "Rules", bodyMarkdown: "# Copyright\r\n\r\nText\r\n" });
  const right = copyrightPolicyContentHash({ version: "1.0", title: "Copyright & DMCA Policy", summary: "Rules", bodyMarkdown: "# Copyright\n\nText" });
  assert.equal(left, right);
});

test("copyright policy hash changes with content", () => {
  const base = { version: "1.0", title: "Copyright & DMCA Policy", summary: "Rules", bodyMarkdown: "# Copyright\n\nText" };
  const left = copyrightPolicyContentHash(base);
  const right = copyrightPolicyContentHash({ ...base, bodyMarkdown: "# Copyright\n\nChanged" });
  assert.notEqual(left, right);
  assert.match(left, /^[a-f0-9]{64}$/);
});

test("starter copyright policy is a legal-review scaffold and not a safe-harbor claim", () => {
  const starter = starterCopyrightPolicy("Duck Studio");
  assert.equal(starter.version, "1.0");
  assert.match(starter.bodyMarkdown, /Duck Studio/);
  assert.match(starter.bodyMarkdown, /not legal advice/i);
  assert.match(starter.bodyMarkdown, /does not by itself establish eligibility/i);
  assert.match(starter.bodyMarkdown, /U\.S\. Copyright Office/);
  assert.match(starter.bodyMarkdown, /counter-notification/i);
  assert.match(starter.bodyMarkdown, /repeat infringers/i);
  assert.match(starter.bodyMarkdown, /\[LEGAL REVIEW REQUIRED\]/);
});
