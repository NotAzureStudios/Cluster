// v1.1 People department identity regressions.
import assert from "node:assert/strict";
import fs from "node:fs";

const people = fs.readFileSync("packages/renderer/src/features/people/PeoplePages.tsx", "utf8");
const summary = fs.readFileSync("packages/renderer/src/components/PersonSummary.tsx", "utf8");
const identity = fs.readFileSync("packages/renderer/src/components/DepartmentIdentityMark.tsx", "utf8");

const tests = [
  [people.includes("const departmentById = useMemo("), "stable identity lookup by department ID"],
  [people.includes("const departmentByName = useMemo("), "safe display-name lookup when summaries contain only names"],
  [people.includes("person.employment?.departmentId"), "employment department ID used first"],
  [people.includes("departmentIdentity={departmentForPerson(person)}"), "member directory passes department identity"],
  [people.includes("departmentIdentity={departmentForPerson(profile)}"), "person profile header passes department identity"],
  [people.includes('cell: (person) => { const department = departmentForPerson(person);'), "table Department column uses canonical mark"],
  [people.includes('departmentForPerson(profile)!} label size={22}'), "profile Organization section uses canonical mark"],
  [people.includes('canEdit={Boolean(currentUser.isAdmin)}'), "UI does not advertise admin-only department controls to non-admins"],
  [people.includes('iconId?: string | null; members: number;'), "workforce identity payload includes icon"],
  [summary.includes("departmentIdentity?: DepartmentIdentity | null"), "PersonSummary supports supplied identity without IO"],
  [summary.includes("<DepartmentIdentityMark department={departmentIdentity} size={17} />"), "icon presented without overriding personal avatar"],
  [!summary.includes("queryApi(") && !identity.includes("queryApi("), "no per-row identity queries"],
];
for (const [ok, label] of tests) assert.ok(ok, label);
console.log(`People department presentation: ${tests.length} contracts passed.`);
