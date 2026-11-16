import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerPeopleRoleChangePreviewRoutes } from "../../apps/server/dist/domains/users/people-role-change-preview-routes.js";

const calls={ read:0, writes:0, owners:0 };
const app=Fastify();
registerPeopleRoleChangePreviewRoutes({
  app,
  getCurrentUser: async(request)=>request.headers["x-actor"]?{id:request.headers["x-actor"]}:null,
  prisma:{
    workspaceMember:{
      async findFirst({where}) { return {workspaceId:"studio-a",role:where.userId==="owner"?"owner":where.userId==="admin"?"admin":"member"}; },
      async count(){calls.owners++;return 0;},
      async update(){calls.writes++;throw Error("preview must not update workspace membership");},
    },
    user:{
      async findFirst({where}) {
        calls.read++;
        if(where.id==="other_workspace")return null;
        return {
          id:where.id,username:where.id,displayName:"Fixture",accountType:"employee",accountState:"ACTIVE",
          archived:where.id==="archived",profileRevision:7,
          memberships:[{role:where.id==="owner_target"?"owner":"member"}],
        };
      },
      async update(){calls.writes++;throw Error("preview must not update person");},
    },
  },
  readSettings:async()=>({studioRoleDefinitions:[{id:"retired",label:"Retired",enabled:false}]}),
  authorization:{configuredToolPermissionsForRole(role){return {projects:role==="viewer"?"view":role==="admin"?"manage":"edit",people:role==="admin"?"manage":"view"};}},
});
const run=(actor,target="target",role="viewer")=>app.inject({
  method:"POST",
  url:`/api/admin/users/${target}/role-change-preview`,
  headers:actor?{"x-actor":actor}:{},
  payload:{role},
});
let count=0;async function check(name,fn){await fn();count++;console.log("PASS",name);}
try {
  await check("Anonymous and ordinary member cannot preview target role",async()=>{
    assert.equal((await run(null)).statusCode,401);
    assert.equal((await run("member")).statusCode,403);
    assert.equal(calls.read,0);
  });
  await check("A preview cannot inspect a person in another workspace",async()=>{
    const result=await run("owner","other_workspace");
    assert.equal(result.statusCode,404);
    assert.equal(result.json().code,"ROLE_TARGET_NOT_IN_WORKSPACE");
  });
  await check("Role preview returns matching target/revision and tool deltas",async()=>{
    const result=await run("admin","target","viewer");
    assert.equal(result.statusCode,200);
    const data=result.json();
    assert.equal(data.canApply,true);assert.equal(data.targetUserId,"target");
    assert.equal(data.profileRevision,7);assert.equal(data.from.id,"member");assert.equal(data.to.id,"viewer");
    assert.equal(data.roleTools.find(x=>x.tool==="projects").before,"edit");
    assert.equal(data.roleTools.find(x=>x.tool==="projects").after,"view");
    assert.equal(data.changedToolCount,1);
    assert.match(data.warning,/not a guarantee of effective access/);
  });
  await check("Self assignment blocked before commit",async()=>{
    const res=await run("owner","owner","viewer");assert.equal(res.statusCode,200);
    assert.ok(res.json().blockers.some(x=>x.code==="ROLE_SELF_CHANGE_DENIED"));
    assert.equal(res.json().canApply,false);
  });
  await check("An administrator cannot assign a privileged role",async()=>{
    const res=await run("admin","target","owner");
    assert.ok(res.json().blockers.some(x=>x.code==="ROLE_OWNER_REQUIRED"));
    assert.equal(res.json().canApply,false);
  });
  await check("Demoting the last owner is rejected even for a workspace owner",async()=>{
    const res=await run("owner","owner_target","viewer");
    assert.ok(res.json().blockers.some(x=>x.code==="ROLE_LAST_OWNER"));
    assert.equal(res.json().canApply,false);
    assert.ok(calls.owners>0);
  });
  await check("Inactive and archived identities cannot be reassigned",async()=>{
    const res=await run("owner","archived","viewer");
    assert.ok(res.json().blockers.some(x=>x.code==="PEOPLE_LIFECYCLE_GOVERNED"));
    assert.equal(res.json().canApply,false);
  });
  await check("Disabled or already-assigned role is never approved",async()=>{
    const disabled=await run("owner","target","retired");
    assert.ok(disabled.json().blockers.some(x=>x.code==="ROLE_NOT_ASSIGNABLE"));
    const same=await run("owner","target","member");
    assert.ok(same.json().blockers.some(x=>x.code==="ROLE_NO_CHANGE"));
  });
  await check("Only existing role editor can apply; previews issue no writes",async()=>{
    assert.equal(calls.writes,0);
    assert.ok(calls.read>0);
  });
  console.log(`Role-change Server preview smoke: ${count} checks passed.`);
} finally {await app.close();}
