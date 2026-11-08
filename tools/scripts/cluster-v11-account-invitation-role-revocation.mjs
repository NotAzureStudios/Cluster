import assert from "node:assert/strict";
import { assignWorkspaceRole } from "../../apps/server/dist/domains/users/people-role-governance.js";

let role="member";
const invitations=[{id:"ticket-1",workspaceId:"studio-a",userId:"target",consumedAt:null,revokedAt:null}];
let locks=0,revocations=0;
const tx={
  async $queryRawUnsafe(sql,key){assert.ok(sql.includes("pg_advisory_xact_lock"));assert.equal(key,"cluster-workspace-role:studio-a");locks++;},
  workspaceMember:{
    async findFirst(){return{workspaceId:"studio-a",role:"owner"};},
    async findUnique(){return{workspaceId:"studio-a",userId:"target",role};},
    async update({data}){role=data.role;return{role};},
    async count(){return 2;},
  },
  studioAccountInvitation:{
    async updateMany({where,data}){
      for(const inv of invitations){
        if(inv.workspaceId!==where.workspaceId||inv.userId!==where.userId||
            (where.consumedAt===null&&inv.consumedAt)||(where.revokedAt===null&&inv.revokedAt))continue;
        inv.revokedAt=data.revokedAt;revocations++;
      }
      return {count:revocations};
    },
  },
};
const settings={};
const target={actorId:"actor",targetUserId:"target",requestedRole:"artist",settings};
const first=await assignWorkspaceRole(tx,target);
assert.equal(first.changed,true);
assert.equal(role,"artist");
assert.equal(revocations,1);
assert.ok(invitations[0].revokedAt instanceof Date);
const back=await assignWorkspaceRole(tx,{...target,requestedRole:"member"});
assert.equal(back.changed,true);
assert.equal(role,"member");
assert.equal(revocations,1);
assert.ok(invitations[0].revokedAt instanceof Date);
const unchanged=await assignWorkspaceRole(tx,{...target,requestedRole:"member"});
assert.equal(unchanged.changed,false);
assert.equal(revocations,1);
assert.equal(locks,3);
console.log("PASS Role change permanently revokes first-login tickets, including role reversal.");
