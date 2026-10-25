import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeOperatorAgreementMarkdown,
  normalizeOperatorAgreementVersion,
  starterOperatorAgreement,
  operatorAgreementContentHash,
} from "../../../apps/server/src/core/operator-agreement.js";

test("operator agreement versions use bounded numeric identifiers", () => {
  assert.equal(normalizeOperatorAgreementVersion(" 1.2.0 "), "1.2.0");
  assert.equal(normalizeOperatorAgreementVersion("2.0-beta.1"), "2.0-beta.1");
  assert.throws(() => normalizeOperatorAgreementVersion("latest"));
  assert.throws(() => normalizeOperatorAgreementVersion("1/../../2"));
});

test("operator agreement markdown is normalized before hashing", () => {
  assert.equal(normalizeOperatorAgreementMarkdown("# Operator Agreement\r\n\r\nText\r\n"), "# Operator Agreement\n\nText");
  const left = operatorAgreementContentHash({ version: "1.0", title: "Server Operator Agreement", summary: "Rules", bodyMarkdown: "# Operator Agreement\r\n\r\nText\r\n" });
  const right = operatorAgreementContentHash({ version: "1.0", title: "Server Operator Agreement", summary: "Rules", bodyMarkdown: "# Operator Agreement\n\nText" });
  assert.equal(left, right);
});

test("operator agreement hash is kind-bound and changes when content changes", () => {
  const base = { version: "1.0", title: "Server Operator Agreement", summary: "Rules", bodyMarkdown: "# Operator Agreement\n\nText" };
  const left = operatorAgreementContentHash(base);
  const right = operatorAgreementContentHash({ ...base, bodyMarkdown: "# Operator Agreement\n\nChanged text" });
  assert.notEqual(left, right);
  assert.match(left, /^[a-f0-9]{64}$/);
});

test("starter operator agreement are an explicit legal-review scaffold", () => {
  const starter = starterOperatorAgreement("Duck Studio");
  assert.equal(starter.version, "1.0");
  assert.match(starter.bodyMarkdown, /Duck Studio/);
  assert.match(starter.bodyMarkdown, /\[LEGAL REVIEW REQUIRED\]/);
  assert.match(starter.bodyMarkdown, /not automatically published or accepted/i);
  assert.match(starter.bodyMarkdown, /Do not transfer ownership/i);
  assert.match(starter.bodyMarkdown, /\[CLUSTER LICENSOR \/ DISTRIBUTOR LEGAL NAME\]/);
});
