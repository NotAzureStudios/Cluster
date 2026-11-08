import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerAccountInvitationRoutes } from "../../apps/server/dist/domains/auth/account-invitation-routes.js";
import { accountInvitationDigest } from "../../apps/server/dist/domains/auth/account-invitation-policy.js";

const records=new Map(), users=new Map(), audits=[], sessionRevocations=[], writes=[];
let seq=0;
function addUser(id, role="member", overrides={}) {
  users.set(id,{
    id,username:id,displayName:id,accountType:"employee",
    passwordHash:"original-temporary-password-hash",
    passwordChangedAt:null,accountState:"PASSWORD_CHANGE_REQUIRED",
    authenticationGeneration:1,verificationGeneration:1,
    accessExpiresAt:null,archived:false,discordUserId:null,role,...overrides,
  });
}
addUser("pending");
addUser("pending2");
addUser("pending3");
addUser("privileged","admin");
addUser("active","member",{accountState:"ACTIVE",passwordChangedAt:new Date()});
addUser("expired","member",{accessExpiresAt:new Date("2020-01-01")});

const prisma={
  workspaceMember:{
    async findFirst({where}) {return {workspaceId:"studio-a",role:where.userId==="owner"?"owner":where.userId==="admin"?"admin":"member"};},
  },
  user:{
    async findFirst({where}){
      const row=users.get(where.id);
      if(!row)return null;
      return {...row,memberships:[{role:row.role}]};
    },
    async updateMany({where,data}){
      const row=users.get(where.id);
      if(!row || where.authenticationGeneration!==row.authenticationGeneration ||
        row.accountState!==where.accountState ||
        (where.passwordChangedAt===null && row.passwordChangedAt) ||
        (where.archived===false && row.archived) ||
        (row.accessExpiresAt && row.accessExpiresAt<=new Date()))return {count:0};
      for(const [key,value]of Object.entries(data)){
        row[key]=value&&typeof value==="object"&&"increment" in value?Number(row[key]||0)+value.increment:value;
      }
      writes.push({kind:"user",id:row.id});
      return {count:1};
    },
  },
  studioAccountInvitation:{
    async updateMany({where,data}){
      let count=0;
      for(const row of records.values()){
        if(where.id && row.id!==where.id)continue;
        if(where.userId && row.userId!==where.userId)continue;
        if(where.tokenHash && row.tokenHash!==where.tokenHash)continue;
        if(where.consumedAt===null && row.consumedAt)continue;
        if(where.revokedAt===null && row.revokedAt)continue;
        if(where.expiresAt?.gt && row.expiresAt<=where.expiresAt.gt)continue;
        Object.assign(row,data);count++;
      }
      if(count)writes.push({kind:"ticket_update",count});
      return {count};
    },
    async create({data}){
      const id=`ticket-${++seq}`;
      const row={id,...data,createdAt:new Date(),consumedAt:null,revokedAt:null};
      records.set(id,row);writes.push({kind:"ticket_create",id});
      return row;
    },
    async findUnique({where}){
      const row=[...records.values()].find(x=>x.tokenHash===where.tokenHash);
      return row?{...row,user:{...users.get(row.userId)}}:null;
    },
    async findMany({where}){
      return [...records.values()].filter(x=>x.workspaceId===where.workspaceId&&x.userId===where.userId)
        .sort((a,b)=>b.createdAt-a.createdAt).slice(0,20);
    },
    async findFirst({where}){
      const row=records.get(where.id);
      return row&&row.workspaceId===where.workspaceId?{id:row.id,userId:row.userId}:null;
    },
  },
  session:{async updateMany(){return {count:0};}},
  securityVerificationGrant:{async updateMany(){return {count:0};}},
  async $transaction(fn){return fn(prisma);},
};

const app=Fastify();
registerAccountInvitationRoutes({
  app,prisma,
  authorization:{
    async requireAdmin(request,reply){
      const id=request.headers["x-actor"];
      if(!id){reply.code(401).send({ok:false});return null;}
      if(!["owner","admin"].includes(id)){reply.code(403).send({ok:false});return null;}
      return {id};
    },
  },
  onUserSessionsRevoked:(...args)=>sessionRevocations.push(args),
  logSecurityEvent:async(event)=>{audits.push(event);},
  hashPassword:async(value)=>"HASH:"+value,
  nextAccountState:()=> "ACTIVE",
  validateNewPassword:(value,user)=>{
    if(value.length<12||value.includes(user.username))throw new Error("Password does not meet policy.");
    return value;
  },
  passwordMinLength:12,passwordMaxLength:1024,webOrigin:"https://cluster.example.test",
  hashToken:(x)=>accountInvitationDigest(x),
  rateLimitKey:async()=>false,
  readSettings:async()=>({}),getCurrentSession:async()=>null,
  requireDiscordLink:false,
});
const req=(method,url,actor,payload)=>app.inject({
  method,url,headers:actor?{"x-actor":actor}:{},...(payload!==undefined?{payload}:{})
});
const issue=(actor,userId)=>req("POST",`/api/admin/users/${userId}/account-invitations`,actor,{});
const activate=(token,password="A strong unique member password 123!")=>req("POST","/api/auth/account-invitations/activate",null,{token,password});
let count=0;
async function check(name,fn){await fn();count++;console.log("PASS",name);}
function rawToken(response) {
  const d=response.json();
  assert.match(d.activationLink,/^https:\/\/cluster\.example\.test\/#activate=[A-Za-z0-9_-]{43}$/);
  return d.activationLink.split("#activate=")[1];
}
try{
  await check("Anonymous and ordinary members cannot issue invitations",async()=>{
    assert.equal((await issue(null,"pending")).statusCode,401);
    assert.equal((await issue("member","pending")).statusCode,403);
    assert.equal(records.size,0);
  });
  await check("Privileged target requires owner, while inactive target is blocked",async()=>{
    assert.equal((await issue("admin","privileged")).statusCode,403);
    assert.equal((await issue("owner","active")).statusCode,409);
    assert.equal((await issue("owner","expired")).statusCode,409);
  });
  let token1;
  await check("Issuance revokes temporary password and only stores token hash",async()=>{
    const res=await issue("admin","pending");
    assert.equal(res.statusCode,200);
    token1=rawToken(res);
    assert.equal(users.get("pending").passwordHash,null);
    assert.equal(users.get("pending").authenticationGeneration,2);
    assert.equal(users.get("pending").accountState,"PASSWORD_CHANGE_REQUIRED");
    assert.equal(records.size,1);
    assert.equal([...records.values()][0].tokenHash,accountInvitationDigest(token1));
    assert.ok(!JSON.stringify([...records.values()]).includes(token1));
    assert.equal(res.headers["cache-control"],"no-store");
    assert.equal(res.headers["set-cookie"],undefined);
  });
  await check("Admin list never returns tokens or invitation links",async()=>{
    const res=await req("GET","/api/admin/users/pending/account-invitations","admin");
    assert.equal(res.statusCode,200);assert.equal(res.json().invitations.length,1);
    assert.equal(res.json().invitations[0].status,"pending");
    assert.ok(!res.body.includes("activationLink")&&!res.body.includes("tokenHash"));
    assert.ok(!res.body.includes(token1));
  });
  await check("Rejected password does not consume invitation",async()=>{
    const res=await activate(token1,"short");
    assert.equal(res.statusCode,400);
    assert.equal([...records.values()][0].consumedAt,null);
  });
  await check("Activation creates password, not a session, and rejects replay",async()=>{
    const res=await activate(token1);
    assert.equal(res.statusCode,200);
    assert.equal(res.headers["set-cookie"],undefined);
    assert.equal(users.get("pending").passwordChangedAt instanceof Date,true);
    assert.equal(users.get("pending").accountState,"ACTIVE");
    assert.equal(users.get("pending").authenticationGeneration,3);
    assert.equal(users.get("pending").passwordHash,"HASH:A strong unique member password 123!");
    assert.equal((await activate(token1)).statusCode,400);
    assert.equal((await issue("owner","pending")).statusCode,409);
    assert.ok(sessionRevocations.some(x=>x[1]==="account_invitation_activated"));
  });
  await check("Replacing an unredeemed link revokes the first",async()=>{
    const a=rawToken(await issue("owner","pending2"));
    const b=rawToken(await issue("owner","pending2"));
    assert.notEqual(a,b);
    assert.equal((await activate(a)).statusCode,400);
    assert.equal((await activate(b)).statusCode,200);
  });
  await check("Explicit revocation blocks redemption",async()=>{
    const token=rawToken(await issue("owner","pending3"));
    const id=[...records.values()].at(-1).id;
    const rev=await req("POST",`/api/admin/account-invitations/${id}/revoke`,"owner",{});
    assert.equal(rev.statusCode,200);assert.equal(rev.json().revoked,true);
    assert.equal((await activate(token)).statusCode,400);
  });
  await check("Unknown, malformed and expired token flows never expose account identity",async()=>{
    const missing=await activate("a".repeat(43));
    assert.equal(missing.statusCode,400);
    assert.equal(missing.json().code,"ACCOUNT_INVITATION_UNAVAILABLE");
    const malformed=await activate("broken");
    assert.equal(malformed.json().code,"ACCOUNT_INVITATION_UNAVAILABLE");
    assert.ok(!missing.body.includes("pending"));
  });
  await check("Audit evidence omits link/token and no activation session creation",async()=>{
    assert.ok(audits.some(x=>x.event==="account.invitation_issued"));
    assert.ok(audits.some(x=>x.event==="account.invitation_activated"));
    assert.ok(!JSON.stringify(audits).includes(token1));
    assert.ok(writes.some(x=>x.kind==="ticket_create"));
  });
  console.log(`Account invitation Fastify smoke: ${count} checks passed.`);
} finally {await app.close();}
