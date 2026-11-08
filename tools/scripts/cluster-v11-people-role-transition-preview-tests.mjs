import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateRoleTransition } from "../../apps/server/dist/domains/users/people-role-transition-preview.js";

const read = file => readFileSync(file,"utf8");
const routes=read("apps/server/src/domains/users/people-administration-preflight-routes.ts");
const panel=read("packages/renderer/src/features/people/PeopleRoleAssignmentPanel.tsx");
const css=read("packages/renderer/src/features/settings/people-management-layout-v11.css");
const settings={studioRoleDefinitions:[{id:"artist",enabled:true},{id:"qa",enabled:false}]};
const input=(partial={})=>({
 actorId:"actor", actorRole:"owner", targetUserId:"target", currentRole:"member", requestedRole:"artist",
 expectedProfileRevision:4, currentProfileRevision:4, otherOwnerCount:1,settings,...partial,
});
let count=0;
function check(n,fn){fn();count++;console.log("PASS",n)}
check("Valid independent role change can be previewed without grants",()=>{
 const p=evaluateRoleTransition(input());
 assert.equal(p.ready,true);
 assert.equal(p.workspaceRoleOnly,true);
 assert.match(p.notice,/Scoped Project grants/);
});
check("Self-change and obsolete revisions are blocked",()=>{
 assert.equal(evaluateRoleTransition(input({actorId:"target"})).ready,false);
 assert.equal(evaluateRoleTransition(input({currentProfileRevision:5})).ready,false);
});
check("Privilege elevation, disabled roles and no-op transitions are blocked",()=>{
 assert.equal(evaluateRoleTransition(input({actorRole:"admin",requestedRole:"owner"})).ready,false);
 assert.equal(evaluateRoleTransition(input({requestedRole:"qa"})).ready,false);
 assert.equal(evaluateRoleTransition(input({requestedRole:"not_a_role"})).ready,false);
 assert.equal(evaluateRoleTransition(input({currentRole:"artist",requestedRole:"artist"})).ready,false);
});
check("No admin can remove last workspace owner",()=>{
 assert.equal(evaluateRoleTransition(input({currentRole:"owner",requestedRole:"member",otherOwnerCount:0})).ready,false);
 assert.equal(evaluateRoleTransition(input({currentRole:"owner",requestedRole:"member",otherOwnerCount:1})).ready,true);
 assert.equal(evaluateRoleTransition(input({currentRole:"admin",requestedRole:"member",actorRole:"admin"})).ready,false);
});
check("Endpoint verifies actor, scope and membership before previewing",()=>{
 const begin=routes.indexOf('app.post("/api/admin/users/:userId/role-preview"');
 const end=routes.indexOf('app.get("/api/users"',begin);
 assert.ok(begin>=0&&end>begin);
 const route=routes.slice(begin,end);
 assert.ok(route.includes('ROLE_ADMIN_REQUIRED'));
 assert.ok(route.includes('workspaceId_userId: { workspaceId: actorMembership.workspaceId, userId: params.data.userId }'));
 assert.ok(route.includes('role: "owner", userId: { not: params.data.userId }'));
 assert.ok(route.includes('expectedProfileRevision: body.data.expectedProfileRevision'));
 assert.ok(!route.includes('workspaceMember.update('));
});
check("Role editor requires a matching policy preflight",()=>{
 assert.ok(panel.includes('const reviewed = preview?.ready === true && previewKey === currentPreviewKey'));
 assert.ok(panel.includes('if (disabled || !next || !reviewed || previewBusy) return;'));
 assert.ok(panel.includes('Review role change'));
 assert.ok(panel.includes('role-preview'));
 assert.ok(panel.includes('await onChange(next.id, person.profileRevision || 1)'));
 assert.ok(css.includes('.people-role-review-v11'));
});
console.log(`People role preview: ${count} checks passed.`);
