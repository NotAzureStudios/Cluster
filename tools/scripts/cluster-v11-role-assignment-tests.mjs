import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const source = readFileSync("apps/server/src/domains/users/people-role-governance.ts", "utf8")
  .replace('from "../../core/postgres-advisory-lock.js"', 'from "./test-deps.ts"')
  .replace('from "./people-governance.js"', 'from "./test-deps.ts"');
const dir = mkdtempSync(join(tmpdir(), "cluster-v11-role-assignment-"));
let helper;
try {
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(join(dir, "test-deps.ts"), `
export class PeopleGovernanceError extends Error {
  constructor(code, message, statusCode=409){super(message);this.code=code;this.statusCode=statusCode;}
}
export async function acquireTransactionAdvisoryLock(tx,key){await tx.__lock(key);}
`);
  writeFileSync(join(dir, "people-role-governance.ts"), source);
  helper = await import(pathToFileURL(join(dir, "people-role-governance.ts")).href);
} finally {
  // Keep copied imports until all tests finish. Clean at the end.
}

const settings = {
  studioRoleDefinitions: [
    { id: "artist", label: "Artist", enabled: false },
    { id: "technical_artist", label: "Technical Artist", enabled: true },
    { id: "__bad role__", label: "Invalid", enabled: true },
  ],
};

let passed=0;
async function check(name,fn){await fn();passed++;console.log("PASS",name);}
function expectCode(code){return (error)=>{assert.equal(error?.code,code);return true;};}
function store({ actorRole="owner",targetRole="member",member=true,otherOwners=1 }={}) {
  const state={ role:targetRole, locks:[], updates:[] };
  const workspaceMember={
    async findFirst(){return actorRole ? {workspaceId:"studio-1",role:actorRole} : null;},
    async findUnique(){return member ? {workspaceId:"studio-1",userId:"target",role:state.role} : null;},
    async count(){return otherOwners;},
    async update({where,data}){assert.equal(where.workspaceId_userId.workspaceId,"studio-1");state.role=data.role;state.updates.push(data.role);},
  };
  return { state, tx:{workspaceMember, async __lock(key){state.locks.push(key);}} };
}
const {assignableStudioRoles,requireAssignableStudioRole,assignWorkspaceRole}=helper;
await check("Built-in roles and configured roles share the canonical catalog",()=>{
  const roles=assignableStudioRoles(settings);
  assert.ok(roles.some((r)=>r.id==="owner"&&r.privileged));
  assert.ok(roles.some((r)=>r.id==="technical_artist"&&r.enabled));
  assert.ok(roles.some((r)=>r.id==="artist"&&!r.enabled));
  assert.ok(!roles.some((r)=>r.id==="__bad role__"));
});
await check("Unknown and disabled roles are not assignable",()=>{
  assert.throws(()=>requireAssignableStudioRole(settings,"ghost"),expectCode("ROLE_NOT_ASSIGNABLE"));
  assert.throws(()=>requireAssignableStudioRole(settings,"artist"),expectCode("ROLE_NOT_ASSIGNABLE"));
});
await check("Noncanonical role IDs rejected",()=>assert.throws(()=>requireAssignableStudioRole(settings,"Admin"),expectCode("ROLE_KEY_INVALID")));
await check("Self reassignment is forbidden",async()=>{
  const {tx}=store();
  await assert.rejects(assignWorkspaceRole(tx,{actorId:"target",targetUserId:"target",requestedRole:"developer",settings}),expectCode("ROLE_SELF_CHANGE_DENIED"));
});
await check("An ordinary member cannot reassign roles",async()=>{
  const {tx}=store({actorRole:"member"});
  await assert.rejects(assignWorkspaceRole(tx,{actorId:"actor",targetUserId:"target",requestedRole:"developer",settings}),expectCode("ROLE_ADMIN_REQUIRED"));
});
await check("No cross-workspace membership is created",async()=>{
  const {tx,state}=store({member:false});
  await assert.rejects(assignWorkspaceRole(tx,{actorId:"actor",targetUserId:"target",requestedRole:"developer",settings}),expectCode("ROLE_TARGET_NOT_IN_WORKSPACE"));
  assert.deepEqual(state.updates,[]);
});
await check("Workspace admin may assign ordinary enabled roles",async()=>{
  const {tx,state}=store({actorRole:"admin"});
  const result=await assignWorkspaceRole(tx,{actorId:"actor",targetUserId:"target",requestedRole:"developer",settings});
  assert.deepEqual(result,{changed:true,from:"member",to:"developer",workspaceId:"studio-1"});
  assert.equal(state.role,"developer");
  assert.deepEqual(state.locks,["cluster-workspace-role:studio-1"]);
});
await check("Workspace admin cannot grant owner/admin",async()=>{
  const {tx}=store({actorRole:"admin"});
  await assert.rejects(assignWorkspaceRole(tx,{actorId:"actor",targetUserId:"target",requestedRole:"owner",settings}),expectCode("ROLE_OWNER_REQUIRED"));
});
await check("Workspace admin cannot demote a privileged account",async()=>{
  const {tx}=store({actorRole:"admin",targetRole:"admin"});
  await assert.rejects(assignWorkspaceRole(tx,{actorId:"actor",targetUserId:"target",requestedRole:"developer",settings}),expectCode("ROLE_OWNER_REQUIRED"));
});
await check("Workspace owner may reassign another admin",async()=>{
  const {tx,state}=store({targetRole:"admin"});
  await assignWorkspaceRole(tx,{actorId:"actor",targetUserId:"target",requestedRole:"qa",settings});
  assert.equal(state.role,"qa");
});
await check("Role reassignment cannot remove a last owner",async()=>{
  const {tx,state}=store({targetRole:"owner",otherOwners:0});
  await assert.rejects(assignWorkspaceRole(tx,{actorId:"actor",targetUserId:"target",requestedRole:"member",settings}),expectCode("ROLE_LAST_OWNER"));
  assert.deepEqual(state.updates,[]);
});
await check("Repeating the same role is a safe no-op",async()=>{
  const {tx,state}=store({targetRole:"member"});
  const result=await assignWorkspaceRole(tx,{actorId:"actor",targetUserId:"target",requestedRole:"member",settings});
  assert.equal(result.changed,false);
  assert.equal(state.updates.length,0);
});

await check("Disabling an assigned built-in role is a revocation even without stored overrides",()=>{
  assert.deepEqual(helper.revokedStudioRoleIds({}, {studioRoleDefinitions:[{id:"member",label:"Member",enabled:false}]}), ["member"]);
});
await check("Removing a custom enabled role is a revocation",()=>{
  assert.deepEqual(helper.revokedStudioRoleIds({studioRoleDefinitions:[{id:"technical_artist",enabled:true}]},{studioRoleDefinitions:[]}), ["technical_artist"]);
});
await check("Removing an explicit override of a built-in role retains the default",()=>{
  assert.deepEqual(helper.revokedStudioRoleIds({studioRoleDefinitions:[{id:"member",enabled:true}]},{studioRoleDefinitions:[]}), []);
});
await check("Adding a new role or enabling a disabled role does not revoke grants",()=>{
  assert.deepEqual(helper.revokedStudioRoleIds({studioRoleDefinitions:[{id:"artist",enabled:false}]},{studioRoleDefinitions:[{id:"artist",enabled:true},{id:"technical_artist",enabled:true}]}), []);
});

const routes=readFileSync("apps/server/src/domains/users/user-directory-routes.ts","utf8");
const ui=readFileSync("packages/renderer/src/features/people/PeopleRoleAssignmentPanel.tsx","utf8");
const people=readFileSync("packages/renderer/src/features/people/PeoplePages.tsx","utf8");
await check("API uses only authorized, guarded workspace role writes",()=>{
  assert.ok(routes.includes("await assignWorkspaceRole(tx, {"));
  assert.ok(!routes.includes("tx.workspaceMember.upsert("));
  assert.ok(routes.includes("ROLE_PROFILE_REVISION_REQUIRED"));
  assert.ok(routes.includes('"/api/admin/users/assignable-roles"'));
  assert.ok(routes.includes('event: "account.role_changed"'));
});
await check("Editor keeps role changes separate and explicitly confirmed",()=>{
  assert.ok(ui.includes("profileDirty || ownerRequired"));
  assert.ok(ui.includes("await confirmCluster({"));
  assert.ok(ui.includes("await onChange(next.id, person.profileRevision || 1)"));
  assert.ok(people.includes("onRoleChange={async (role, expectedProfileRevision) => {"));
});

rmSync(dir,{recursive:true,force:true});
console.log(`Cluster v1.1 role assignment: ${passed} runtime and integration checks passed.`);
