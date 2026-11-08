import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerPeopleAdministrationPreflightRoutes } from "../../apps/server/dist/domains/users/people-administration-preflight-routes.js";

const app=Fastify();
const calls={reads:0,writes:0};
let owners=0;
const prisma={
  workspaceMember:{
    async findFirst({where}){
      calls.reads++;
      if(where.userId==="owner")return{workspaceId:"studio-1",role:"owner"};
      if(where.userId==="admin")return{workspaceId:"studio-1",role:"admin"};
      return{workspaceId:"studio-1",role:"member"};
    },
    async findUnique({where}){
      calls.reads++;
      const target=where.workspaceId_userId;
      if(target.workspaceId!=="studio-1"||target.userId==="foreign")return null;
      return {userId:target.userId,role:target.userId==="last-owner"?"owner":"member",
        user:{profileRevision:2,archived:target.userId==="archived",accountState:"ACTIVE"}};
    },
    async count(){calls.reads++;return owners;},
    async update(){calls.writes++;throw Error("Unexpected mutation");}
  }
};
registerPeopleAdministrationPreflightRoutes({
  app,prisma,
  getCurrentUser:async(request)=>request.headers["x-test-actor"]?{id:request.headers["x-test-actor"]}:null,
  readSettings:async()=>({studioRoleDefinitions:[{id:"artist",label:"Artist",enabled:true},{id:"disabled",enabled:false}]}),
});
const inject=(actor,path,payload)=>app.inject({method:"POST",url:path,headers:actor?{"x-test-actor":actor}: {},payload});
const provision="/api/admin/users/provisioning-preview";
const role=(id)=>`/api/admin/users/${id}/role-preview`;
const provisionBody={role:"member",accountType:"employee",accessExpiresAt:null};
const roleBody={role:"artist",expectedProfileRevision:2};
let count=0;
async function check(name,fn){await fn();count++;console.log("PASS",name);}
try{
  await check("Unauthorized and ordinary users cannot preview provisioning",async()=>{
    assert.equal((await inject(null,provision,provisionBody)).statusCode,401);
    assert.equal((await inject("member",provision,provisionBody)).statusCode,403);
    assert.equal((await inject("member",role("last-owner"),roleBody)).statusCode,403);
  });
  await check("Preview input is strict and cannot carry unauthorized tool grants",async()=>{
    assert.equal((await inject("admin",provision,{...provisionBody,toolPermissions:{serverConfig:"manage"}})).statusCode,400);
    assert.equal((await inject("owner",role("target"),{...roleBody,toolPermissions:{serverConfig:"manage"}})).statusCode,400);
  });
  await check("External identities require expiry and admin cannot elevate to owner",async()=>{
    assert.equal((await inject("admin",provision,{...provisionBody,role:"owner"})).json().ready,false);
    assert.equal((await inject("owner",provision,{...provisionBody,accountType:"guest"})).json().ready,false);
    const good=await inject("owner",provision,{...provisionBody,accountType:"guest",accessExpiresAt:"2027-01-01T23:59:59.000Z"});
    assert.equal(good.statusCode,200);
    assert.equal(good.json().ready,true);
    assert.equal(good.json().projectGrants,"SEPARATE_APPROVAL_REQUIRED");
  });
  await check("Role preview is workspace scoped and blocks unavailable identities",async()=>{
    assert.equal((await inject("admin",role("foreign"),roleBody)).statusCode,404);
    assert.equal((await inject("admin",role("archived"),roleBody)).statusCode,404);
  });
  await check("Role preview blocks stale snapshots and self-changes",async()=>{
    assert.equal((await inject("owner",role("target"),{...roleBody,expectedProfileRevision:1})).json().ready,false);
    assert.equal((await inject("owner",role("owner"),roleBody)).json().ready,false);
  });
  await check("Last owner cannot be demoted by preflight",async()=>{
    owners=0;
    assert.equal((await inject("owner",role("last-owner"),{...roleBody,role:"member"})).json().ready,false);
    owners=1;
    assert.equal((await inject("owner",role("last-owner"),{...roleBody,role:"member"})).json().ready,true);
  });
  await check("Preflight never writes roles, account records or grants",async()=>{
    assert.equal(calls.writes,0);
    assert.ok(calls.reads>0);
  });
  console.log(`People preflight Fastify HTTP: ${count} checks passed.`);
}finally{await app.close();}
