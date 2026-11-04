// v1.1: department appearance is owned by canonical workforce records.
import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("apps/server/src/domains/workforce/workforce-routes.ts", "utf8");
const repo = fs.readFileSync("apps/server/src/domains/departments/department-repository.ts", "utf8");
const manager = fs.readFileSync("packages/renderer/src/features/settings/WorkforceDepartmentManager.tsx", "utf8");
const settings = fs.readFileSync("packages/renderer/src/features/settings/StudioSettingsPage.tsx", "utf8");

const deptSection = settings.slice(settings.indexOf('{section === "departments" && ('), settings.indexOf('{section === "roles" && ('));
const begin = route.indexOf('app.post("/api/admin/workforce/departments"');
const end = route.indexOf('app.patch("/api/admin/workforce/departments/:id"', begin);
assert.ok(begin > 0 && end > begin, "canonical department POST exists");
const create = route.slice(begin, end);
const tests = [
  [repo.includes("description: row.description || null") && repo.includes("revision: Number(row.revision || 1)"), "read contract exposes revision and description"],
  [create.includes("workspaceId: z.string().min(1).optional()"), "new department can use actor workspace"],
  [create.includes("where: { userId: identity.user.id, ...(body.workspaceId ? { workspaceId: body.workspaceId } : {}) }"), "workspace ownership verified before creation"],
  [create.includes("const workspaceId = membership.workspaceId"), "authoritative workspace comes from membership"],
  [create.includes("data: { ...body, workspaceId"), "new department persists scoped workspace ID"],
  [manager.includes('queryApi<DepartmentRow[]>("/api/departments"'), "thin scoped department directory used"],
  [manager.includes('method: "PATCH"') && manager.includes("expectedRevision: selected!.revision"), "edits require optimistic revision"],
  [manager.includes('method: "POST"') && manager.includes('"/api/admin/workforce/departments"'), "new department uses canonical endpoint"],
  [manager.includes("<DepartmentIdentityMark department={row} size={27} />") && manager.includes("<ResourceIconPicker"), "identity displayed and edited"],
  [manager.includes("useUnsavedChangesGuard({") && manager.includes("confirmDiscard()"), "unsaved edits protected"],
  [manager.includes('if (rows.some((row) => row.id !== selected?.id'), "duplicate names rejected early"],
  [deptSection.includes("<WorkforceDepartmentManager />"), "Studio Settings puts canonical editor first"],
  [deptSection.includes('<summary><strong>Department access templates & defaults</strong>'), "separate permission templates labeled as such"],
  [deptSection.includes("Icons and colors are edited above in the canonical department directory."), "policy editor no longer owns appearance"],
  [!deptSection.includes('value={selectedDepartment.iconId}') && !deptSection.includes('value={selectedDepartment.accentColor'), "old duplicate appearance controls removed"],
  [deptSection.includes("studioDepartmentDefinitions") || deptSection.includes("departmentRoleCoverage"), "existing policy defaults preserved"],
];
for(const [ok,label] of tests) assert.ok(ok,label);
console.log(`Canonical department management: ${tests.length} contracts passed.`);
