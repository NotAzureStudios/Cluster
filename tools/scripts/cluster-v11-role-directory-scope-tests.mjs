import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const base="apps/server/src/domains/roles/";
const files=[
  ["role-repository.ts",readFileSync(base+"role-repository.ts","utf8")],
  ["role-service.ts",readFileSync(base+"role-service.ts","utf8").replace("./role-repository.js","./role-repository.ts")],
  ["role-routes.ts",readFileSync(base+"role-routes.ts","utf8").replace("./role-service.js","./role-service.ts")],
];
const folder=mkdtempSync(join(tmpdir(),"cluster-v11-role-scope-"));
try {
  writeFileSync(join(folder,"package.json"),'{"type":"module"}');
  for(const [name,s] of files)writeFileSync(join(folder,name),s);
  const {registerRoleRoutes}=await import(pathToFileURL(join(folder,"role-routes.ts")).href);
  let endpoint;
  const scopedReads=[];
  let actorId="actor-1",memberWorkspace="studio-A",allowTool=true;
  const deps={
    app:{get(path,handler){assert.equal(path,"/api/roles");endpoint=handler;}},
    authorization:{
      async requireTool(){return allowTool;},
      async identityForRequest(){return actorId ? {user:{id:actorId}} : null;},
      configuredToolPermissionsForRole(role){return {people:role==="admin"?"manage":"view"};},
    },
    prisma:{
      workspaceMember:{
        async findFirst({where,select,orderBy}){
          assert.equal(where.userId,actorId);
          assert.equal(select.workspaceId,true);
          assert.equal(orderBy.workspaceId,"asc");
          return memberWorkspace ? {workspaceId:memberWorkspace} : null;
        },
        async groupBy(query){
          assert.equal(query.where.workspaceId,memberWorkspace);
          scopedReads.push(query.where.workspaceId);
          return [
            {role:"admin",_count:{_all:2}},
            {role:"member",_count:{_all:7}},
          ];
        },
      },
    },
  };
  registerRoleRoutes(deps);
  const reply={code(status){this.status=status;return this;},send(body){this.body=body;return body;}};
  const run=()=>endpoint({},reply);
  let passed=0;
  async function check(name,fn){await fn();passed++;console.log("PASS",name);}
  await check("Role directory enforces workspace-scoped counts",async()=>{
    const roles=await run();
    assert.deepEqual(scopedReads,["studio-A"]);
    assert.equal(roles.length,2);
    assert.equal(roles.find(r=>r.name==="member").members,7);
    assert.equal(roles.find(r=>r.name==="admin").toolPermissions.people,"manage");
  });
  await check("No user identity produces 401 before querying memberships",async()=>{
    actorId="";
    const value=await run();
    assert.equal(value.code,"AUTH_REQUIRED");
    assert.equal(reply.status,401);
    assert.equal(scopedReads.length,1);
    actorId="actor-1";
  });
  await check("No workspace membership returns no cross-workspace role data",async()=>{
    memberWorkspace=null;
    const roles=await run();
    assert.deepEqual(roles,[]);
    assert.equal(scopedReads.length,1);
    memberWorkspace="studio-A";
  });
  await check("People-view permission required before directory query",async()=>{
    allowTool=false;
    const value=await run();
    assert.equal(value,undefined);
    assert.equal(scopedReads.length,1);
  });
  console.log(`v1.1 role-directory scope: ${passed} real route tests passed.`);
} finally {rmSync(folder,{recursive:true,force:true});}
