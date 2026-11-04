import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canChooseStudioRole } from "../../packages/renderer/src/features/people/people-role-choice.ts";

const enabled = { id:"developer", label:"Developer", members: 2, privileged:false, enabled:true };
const disabled = { ...enabled, enabled:false };
const privileged = { ...enabled, id:"admin", label:"Admin", privileged:true };
let count=0;
function check(name, action){ action(); count++; console.log("PASS",name); }
check("Members can be assigned by regular administrators",()=>assert.equal(canChooseStudioRole(enabled,"admin"),true));
check("Disabled roles are not assignable to anyone",()=>{
  assert.equal(canChooseStudioRole(disabled,"owner"),false);
  assert.equal(canChooseStudioRole(disabled,"admin"),false);
});
check("Privileged roles require the owner",()=>{
  assert.equal(canChooseStudioRole(privileged,"admin"),false);
  assert.equal(canChooseStudioRole(privileged,"owner"),true);
});
check("Missing/stale role catalogs never authorize creation",()=>{
  assert.equal(canChooseStudioRole(undefined,"owner"),false);
  assert.equal(canChooseStudioRole(enabled,null),true);
  assert.equal(canChooseStudioRole(privileged,null),false);
});
const page=readFileSync("packages/renderer/src/features/people/PeoplePages.tsx","utf8");
const server=readFileSync("apps/server/src/domains/users/user-directory-routes.ts","utf8");
check("Create form uses authorized fresh catalog, not fixed Member/Viewer options",()=>{
  assert.ok(page.includes('queryApi<CreateRoleCatalog>("/api/admin/users/assignable-roles"'));
  assert.ok(page.includes('force: true, staleMs: 0, persist: false'));
  assert.ok(page.includes("(createRoleCatalog?.roles || []).map("));
  assert.ok(!page.includes('<option value="member">Member</option><option value="viewer">Viewer</option>'));
});
check("The create button is gated until role catalog is loaded",()=>{
  assert.ok(page.includes('disabled={createAccountBusy || createRoleLoading || !createRoleCatalog || Boolean(createRoleError)}'));
  assert.ok(page.includes('if (!canChooseStudioRole(assignable, createRoleCatalog?.actorRole))'));
});
check("Server enforces role eligibility and privileged owner authorization",()=>{
  assert.ok(server.includes('requireAssignableStudioRole(await readSettings(), body.role)'));
  assert.ok(server.includes('role.privileged && actorMembership.role !== "owner"'));
  assert.ok(server.includes('ROLE_OWNER_REQUIRED'));
});
check("User-credential lifecycle remains protected after account creation",()=>{
  assert.ok(page.includes('if (accountScopeRef.current !== scope) return;'));
  assert.ok(page.includes('setIssuedCredential({ username: created.username, temporaryPassword: created.temporaryPassword })'));
});
console.log(`v1.1 create-account role catalog: ${count} checks passed.`);
