import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerStudioOnboardingRoutes } from "../../apps/server/dist/domains/studio-systems/studio-onboarding-routes.js";

const assigned=new Map();
let writes=0;
let broadcastCalls=0;
const prisma={
  workspaceMember:{
    async findFirst({where}){return {workspaceId:"studio-a",role:where.userId==="owner"?"owner":where.userId==="admin"?"admin":"member"};},
  },
  studioOnboardingPlanVersion:{
    async findUnique({where}){
      if(where.id==="not_published")return {id:where.id,status:"draft",plan:{status:"active",title:"Draft",audienceJson:'{"mode":"all","targets":[]}' }};
      return {id:where.id,status:"published",plan:{status:"active",title:"New member setup",audienceJson:'{"mode":"all","targets":[]}'},dueAfterDays:5};
    },
  },
  user:{
    async findFirst({where}){
      if(where.id==="other_workspace"||where.id==="disabled")return null;
      return {id:where.id,username:where.id,archived:false,accountState:"PASSWORD_CHANGE_REQUIRED",
        accessExpiresAt:where.id==="expired"?new Date("2020-01-01"):null};
    },
  },
  studioOnboardingAssignment:{
    async createMany({data,skipDuplicates}){
      assert.equal(skipDuplicates,true);
      assert.equal(data.length,1);
      const row=data[0];
      const key=row.planVersionId+":"+row.userId;
      if(assigned.has(key))return {count:0};
      writes++;
      assigned.set(key,{id:"assignment-"+writes,status:"active",dueAt:row.dueAt,...row});
      return {count:1};
    },
    async findUniqueOrThrow({where}){
      const key=where.planVersionId_userId.planVersionId+":"+where.planVersionId_userId.userId;
      if(!assigned.has(key))throw Error("missing fixture");
      return assigned.get(key);
    },
  },
  async $transaction(fn){return fn(prisma);},
};
const app=Fastify();
registerStudioOnboardingRoutes({
  app,prisma,
  authorization:{
    async requireTool(request,reply){
      if(!request.headers["x-actor"]){reply.code(401).send({ok:false});return null;}
      return {id:request.headers["x-actor"]};
    },
  },
  getCurrentUser:async(request)=>request.headers["x-actor"]?{id:request.headers["x-actor"]}:null,
  logActivity:async()=>{},
  jobQueue:null,
});
const send=(actor,userId="newperson",versionId="published")=>app.inject({
  method:"POST",url:`/api/studio-systems/onboarding/versions/${versionId}/assign-person`,
  headers:actor?{"x-actor":actor}:{},
  payload:{userId},
});
let count=0;async function check(name,fn){await fn();count++;console.log("PASS",name);}
try{
  await check("Anonymous users cannot assign onboarding",async()=>{
    assert.equal((await send(null)).statusCode,401);assert.equal(writes,0);
  });
  await check("Ordinary members cannot assign onboarding",async()=>{
    assert.equal((await send("member")).statusCode,403);assert.equal(writes,0);
  });
  await check("Invalid person and draft version are not assignable",async()=>{
    assert.equal((await send("admin","other_workspace")).statusCode,404);
    assert.equal((await send("owner","newperson","not_published")).statusCode,404);
    assert.equal(writes,0);
  });
  await check("Expired and unavailable users cannot receive onboarding",async()=>{
    assert.equal((await send("owner","expired")).statusCode,409);
    assert.equal((await send("owner","disabled")).statusCode,404);
    assert.equal(writes,0);
  });
  await check("A published version is assigned only to the selected person",async()=>{
    const result=await send("admin","newperson");
    assert.equal(result.statusCode,200);
    assert.equal(result.json().created,true);
    assert.equal(result.json().status,"active");
    assert.equal(writes,1);assert.equal(assigned.size,1);
    assert.ok(assigned.has("published:newperson"));
  });
  await check("Reassignment is idempotent and cannot broadcast to audience",async()=>{
    const result=await send("owner","newperson");
    assert.equal(result.statusCode,200);
    assert.equal(result.json().created,false);
    assert.equal(writes,1);
    assert.equal(broadcastCalls,0);
  });
  await check("Inactive duplicate needs governed reactivation, not silent success",async()=>{
    assigned.get("published:newperson").status="revoked";
    const result=await send("owner","newperson");
    assert.equal(result.statusCode,409);
    assert.equal(result.json().code,"ONBOARDING_ASSIGNMENT_INACTIVE");
    assert.equal(writes,1);
  });
  console.log(`Targeted onboarding endpoint: ${count} checks passed.`);
}finally{await app.close();}
