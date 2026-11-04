import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PEOPLE_EDITOR_FIELDS, preparePeopleEditorPatch, changedPeopleEditorFields,
} from "../../packages/renderer/src/features/people/people-user-editor-draft.ts";

const empty = () => Object.fromEntries(PEOPLE_EDITOR_FIELDS.map((key) => [key, ""]));
function drafts() {
  const opened = { ...empty(), username: "studio_dev", displayName: "Studio Dev", capacityHours: "40", minimumHours: "20" };
  return { opened, draft: { ...opened } };
}
let checks = 0;
function check(label, fn) { fn(); checks++; console.log("PASS", label); }

check("Only deliberately changed fields and opened revision leave the editor", () => {
  const { opened, draft } = drafts();
  draft.displayName = "New Name";
  const patch = preparePeopleEditorPatch(draft, opened, 7, opened.username);
  assert.deepEqual(patch, { expectedProfileRevision: 7, displayName: "New Name" });
  assert.equal("role" in patch, false);
  assert.equal("accountType" in patch, false);
  assert.equal("accessExpiresAt" in patch, false);
  assert.equal("projectPermissions" in patch, false);
});
check("Empty draft does not write", () => {
  const { opened, draft } = drafts();
  assert.deepEqual(changedPeopleEditorFields(draft, opened), []);
  assert.throws(() => preparePeopleEditorPatch(draft, opened, 7, opened.username), /No profile changes/);
});
check("Empty optional fields become null", () => {
  const { opened, draft } = drafts();
  opened.phoneNumber = "555-0101";
  draft.phoneNumber = "";
  const patch = preparePeopleEditorPatch(draft, opened, 7, opened.username);
  assert.equal(patch.phoneNumber, null);
});
check("Exact zero and null hours serialize predictably", () => {
  const { opened, draft } = drafts();
  draft.minimumHours = "0";
  draft.capacityHours = "";
  const patch = preparePeopleEditorPatch(draft, opened, 7, opened.username);
  assert.equal(patch.minimumHours, 0);
  assert.equal(patch.capacityHours, null);
});
check("Minimum cannot exceed capacity", () => {
  const { opened, draft } = drafts();
  draft.minimumHours = "41";
  assert.throws(() => preparePeopleEditorPatch(draft, opened, 7, opened.username), /Minimum hours cannot exceed/);
});
check("Invalid hour values rejected", () => {
  const { opened, draft } = drafts();
  for (const value of ["-1", "169", "2.5", "oops"]) {
    draft.capacityHours = value;
    assert.throws(() => preparePeopleEditorPatch(draft, opened, 7, opened.username), /whole numbers/);
  }
});
check("Invalid and impossible dates rejected", () => {
  const { opened, draft } = drafts();
  for (const value of ["2026-02-30", "2026-13-01", "2026-11-4", "invalid"]) {
    draft.startDate = value;
    assert.throws(() => preparePeopleEditorPatch(draft, opened, 7, opened.username), /valid employment start date/);
  }
});
check("Valid calendar date passes", () => {
  const { opened, draft } = drafts();
  draft.startDate = "2024-02-29";
  assert.equal(preparePeopleEditorPatch(draft, opened, 7, opened.username).startDate, "2024-02-29");
});
check("Time zone validation rejects unknown zones", () => {
  const { opened, draft } = drafts();
  draft.timezone = "Mars/Olympus";
  assert.throws(() => preparePeopleEditorPatch(draft, opened, 7, opened.username), /valid IANA time zone/);
  draft.timezone = "America/New_York";
  assert.equal(preparePeopleEditorPatch(draft, opened, 7, opened.username).timezone, "America/New_York");
});
check("Email and name validated", () => {
  const { opened, draft } = drafts();
  draft.email = "not-an-email";
  assert.throws(() => preparePeopleEditorPatch(draft, opened, 7, opened.username), /valid email/);
  draft.email = "";
  draft.username = "a";
  assert.throws(() => preparePeopleEditorPatch(draft, opened, 7, opened.username), /between 3 and 32/);
});
check("Internal notes and staff code bounded", () => {
  const { opened, draft } = drafts();
  draft.employeeNumber = "x".repeat(81);
  assert.throws(() => preparePeopleEditorPatch(draft, opened, 7, opened.username), /Employee number/);
  draft.employeeNumber = "";
  draft.notes = "n".repeat(4001);
  assert.throws(() => preparePeopleEditorPatch(draft, opened, 7, opened.username), /Internal notes/);
});
check("Invalid or missing optimistic revision rejected", () => {
  const { opened, draft } = drafts();
  draft.displayName = "Updated";
  assert.throws(() => preparePeopleEditorPatch(draft, opened, 0, opened.username), /Reload this profile/);
});
check("User editor pins initial revision against background refresh", () => {
  const editor = readFileSync("packages/renderer/src/features/people/PeopleUserEditor.tsx", "utf8");
  assert.ok(editor.includes("const openedRevision = useRef(person.profileRevision || 1)"));
  assert.ok(editor.includes("preparePeopleEditorPatch(draft, initial, openedRevision.current"));
  assert.ok(!editor.includes("expectedProfileRevision: person.profileRevision || 1"));
});
check("Role/lifecycle security remain separate", () => {
  const editor = readFileSync("packages/renderer/src/features/people/PeopleUserEditor.tsx", "utf8");
  assert.ok(editor.includes("<PeopleRoleAssignmentPanel"));
  assert.ok(!PEOPLE_EDITOR_FIELDS.includes("role"));
  assert.ok(!PEOPLE_EDITOR_FIELDS.includes("archived"));
  assert.ok(!PEOPLE_EDITOR_FIELDS.includes("accessExpiresAt"));
});
console.log(`v1.1 user editor: ${checks} runtime and source checks passed.`);
