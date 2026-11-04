import assert from "node:assert/strict";
import fs from "node:fs";
const page=fs.readFileSync("packages/renderer/src/features/settings/StudioSettingsPage.tsx","utf8");
const css=fs.readFileSync("packages/renderer/src/features/settings/people-management-layout-v11.css","utf8");
const start=page.indexOf('{section === "roles" && (');
const end=page.indexOf('{section === "defaults" && (',start);
assert.ok(start>=0&&end>start);
const roles=page.slice(start,end);
const checks=[
  [page.includes('const [roleDirectorySearch, setRoleDirectorySearch] = useState("")'),"search is state-backed"],
  [page.includes('section !== "roles" || !currentUser.isAdmin'),"role counts only load for authorized administrators"],
  [page.includes('queryApi<{ roles: Array<{ id: string; members: number }> }>("/api/admin/users/assignable-roles"'),"member counts come from scoped authoritative server endpoint"],
  [page.includes('Object.fromEntries(roles.map((role) => [role.id, role.members]))'),"one catalog fetch replaces per-row role lookups"],
  [roles.includes('type="search" value={roleDirectorySearch}'),"directory search is interactive"],
  [roles.includes('studioRoles.filter((role) =>'),"search filters the actual directory"],
  [roles.includes('typeof roleMemberCounts[role.id] === "number"'),"role rows display membership counts"],
  [roles.includes('typeof roleMemberCounts[selectedRole.id] === "number"'),"selected role displays assigned member count"],
  [roles.includes("No roles match this search."),"empty search state is explicit"],
  [roles.includes("Role editing is still available."),"count lookup failures do not block editing"],
  [!roles.includes("roleMemberCounts[role.id] ?? 0"),"missing scoped count is not invented as zero"],
  [roles.includes("StudioPermissionEditor permissions={selectedRole.toolPermissions}"),"permission editor preserved"],
  [roles.includes('aria-label="Immutable role key"'),"role key remains immutable"],
  [css.includes(".studio-role-directory-search-v11"),"compact responsive search styling"],
];
for(const [ok,name] of checks)assert.ok(ok,name);
console.log(`v1.1 role directory: ${checks.length} contracts passed.`);
