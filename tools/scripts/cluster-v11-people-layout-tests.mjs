// v1.1 management layout regressions; preserves policies while changing structure.
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("packages/renderer/src/features/settings/StudioSettingsPage.tsx", "utf8");
const css = fs.readFileSync("packages/renderer/src/features/settings/people-management-layout-v11.css", "utf8");
const between = (start, next) => {
  const a = source.indexOf(start), b = source.indexOf(next, a);
  assert.ok(a >= 0 && b > a, `Missing section: ${start}`);
  return source.slice(a, b);
};
const departments = between('{section === "departments" && (', '{section === "roles" && (');
const roles = between('{section === "roles" && (', '{section === "defaults" && (');

const contracts = [
  [source.includes("const [roleCreationOpen, setRoleCreationOpen] = useState(false)"), "role form disclosed on demand"],
  [source.includes("const [departmentCreationOpen, setDepartmentCreationOpen] = useState(false)"), "department form disclosed on demand"],
  [departments.includes("aria-expanded={departmentCreationOpen}") && roles.includes("aria-expanded={roleCreationOpen}"), "create buttons expose expanded state"],
  [departments.indexOf('<WorkforceDepartmentManager canEdit={Boolean(currentUser.isAdmin)} onRowsLoaded={setWorkforceDepartmentRows} />') < departments.indexOf('studio-advanced-access-v11'), "canonical department directory precedes advanced defaults"],
  [departments.indexOf('studio-entity-manager-v272') > departments.indexOf('studio-department-templates-v11'), "permission templates appear only in advanced policy disclosure"],
  [roles.indexOf('studio-entity-manager-v272') < roles.indexOf('studio-advanced-access-v11'), "role editor precedes policy machinery"],
  [roles.indexOf('studio-create-role-v272') < roles.indexOf('studio-entity-manager-v272'), "role creation is near primary editor"],
  [roles.includes('aria-label="Permission bundle library"') && roles.includes('aria-label="Project bundle ceilings"'), "bundle and ceiling policies preserved"],
  [roles.includes('label="Role settings"') && roles.includes('"permissions", label: "Tool access"') && roles.includes('"actions", label: "Protected actions"'), "role editing tabs preserved"],
  [departments.includes('label="Department settings"') && departments.includes('"roles", label: "Roles & actions"'), "department editing tabs preserved"],
  [departments.includes('onClick={() => applyDepartmentDefaults(selectedDepartment)}'), "onboarding department default preserved"],
  [roles.includes("StudioPermissionEditor permissions={selectedRole.toolPermissions}"), "effective role permission editor preserved"],
  [source.includes("setRoleCreationOpen(false)") && source.includes("setDepartmentCreationOpen(false)"), "new-item forms dismiss after creation"],
  [css.includes("border-left:2px solid transparent") && css.includes("var(--accent,#57c1ff)"), "thin active indicator"],
  [css.includes("@media(max-width:950px)") && css.includes("@media(max-width:620px)"), "responsive layouts"],
  [css.includes("@media(prefers-reduced-motion:reduce)"), "reduced motion"],
];
for (const [ok, description] of contracts) assert.ok(ok, description);
console.log(`v1.1 People settings layout: ${contracts.length} contracts passed.`);
