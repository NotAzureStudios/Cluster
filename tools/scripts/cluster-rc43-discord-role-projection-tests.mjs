import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}})();
const root=path.resolve(new URL('../..',import.meta.url).pathname);
function moduleFrom(file,mocks={}) {
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};
 vm.runInNewContext(code,{exports,require:(id)=>mocks[id]||require(id),console,process,Date,Buffer,Math,BigInt,Set,Map,JSON},{filename:file});
 return exports;
}
const error=(code,message,statusCode)=>Object.assign(new Error(message),{code,statusCode});
const {createDiscordRoleProjectionService,planDiscordRoleChanges}=moduleFrom('apps/server/src/domains/integrations/discord-role-projection.ts',{'../../core/http-errors.js':{createHttpError:error}});
const guild='111111111111111111', outside='222222222222222222';
const employeeRole='333333333333333333', teamRole='444444444444444444', unsafeRole='555555555555555555';
const discordA='666666666666666666', discordB='777777777777777777', botId='888888888888888888';
const conn={id:'conn',workspaceId:'studio',configuration:JSON.stringify({authorizedGuildIds:[],discordRoleSyncEnabled:false}),status:'configured'};
const users=[{id:'a',accountState:'ACTIVE',archived:false,accountType:'employee',discordUserId:discordA},{id:'b',accountState:'ACTIVE',archived:false,accountType:'contractor',discordUserId:discordB},{id:'expired',accountState:'ACTIVE',archived:false,accountType:'employee',discordUserId:'999999999999999999',accessExpiresAt:new Date('2000-01-01')}];
const roles=[{id:guild,permissions:'1024',position:0},{id:employeeRole,permissions:'0',position:1},{id:teamRole,permissions:'0',position:2},{id:unsafeRole,permissions:'8',position:3},{id:'987654321987654321',permissions:String(1<<28),position:10}];
const memberRoles=new Map([[discordA,new Set()], [discordB,new Set([teamRole])]]);
const records=[]; let events=[]; let next=0, guildCalls=0, failPut=false;
const prisma={
 integrationConnection:{findFirst:async()=>conn,updateMany:async({where,data})=>{if(where.configuration!==conn.configuration)return {count:0};Object.assign(conn,data);return {count:1};}},
 studioTeam:{findMany:async()=>[{id:'team1',name:'Development'}],findFirst:async({where})=>where.id==='team1'?{id:'team1'}:null},
 studioTeamMember:{findMany:async()=>[{userId:'b',teamId:'team1'}],findFirst:async({where})=>where.userId==='b'&&where.teamId==='team1'?{userId:'b',teamId:'team1'}:null},
 workspaceMember:{findMany:async()=>users.map(user=>({user})),findFirst:async({where})=>users.some(u=>u.id===where.userId)?{userId:where.userId}:null},
 user:{findUnique:async({where})=>users.find(u=>u.id===where.id)||null},
 discordRoleProjection:{
  findMany:async({where})=>records.filter(r=>r.connectionId===where.connectionId&&(where.status.in.includes(r.status))),
  findFirst:async({where})=>records.find(r=>r.connectionId===where.connectionId&&r.guildId===where.guildId&&r.discordUserId===where.discordUserId&&r.roleId===where.roleId)||null,
  count:async({where})=>records.filter(r=>r.connectionId===where.connectionId&&where.status.in.includes(r.status)).length,
  create:async({data})=>{if(records.some(r=>r.connectionId===data.connectionId&&r.guildId===data.guildId&&r.discordUserId===data.discordUserId&&r.roleId===data.roleId))throw Object.assign(new Error('duplicate'),{code:'P2002'});const r={id:`r${++next}`,...data};records.push(r);return r;},
  updateMany:async({where,data})=>{const r=records.find(x=>x.id===where.id&&x.status===where.status);if(!r)return {count:0};Object.assign(r,data);return {count:1};},
  update:async({where,data})=>{const r=records.find(x=>x.id===where.id);Object.assign(r,data);return r;},
 },
};
const requests=[];
const discordRequest=async (_s,url,opts={})=>{
 requests.push({url,method:opts.method||'GET'});
 if(url==='/users/@me')return {id:botId};
 if(url===`/guilds/${guild}/roles`){guildCalls++;return roles;}
 if(url===`/guilds/${guild}/members/${botId}`)return {roles:['987654321987654321']};
 const path=url.match(new RegExp(`^/guilds/${guild}/members/(\\d+)(?:/roles/(\\d+))?$`));
 if(path){const id=path[1],role=path[2];if(!role)return {roles:[...(memberRoles.get(id)||[])]};if(opts.method==='PUT'){if(failPut)throw new Error('Discord timeout');memberRoles.get(id)?.add(role);return null;}if(opts.method==='DELETE'){memberRoles.get(id)?.delete(role);return null;}}
 throw new Error(`Unexpected Discord request ${url}`);
};
const service=createDiscordRoleProjectionService({prisma,readSettings:async()=>({discordGuildId:guild,discordBotToken:'test'}),discordRequest});
let total=0;
async function check(name,fn){await fn();console.log('PASS '+(++total)+': '+name)}
await check('role plans never propose removing a manually owned role',()=>{
 const desired=new Map();const result=planDiscordRoleChanges(desired,[{id:'1',discordUserId:discordA,roleId:teamRole,status:'uncertain'},{id:'2',discordUserId:discordB,roleId:teamRole,status:'managed'}]);
 assert.equal(result.revokes.length,1);assert.equal(result.revokes[0].id,'2');
});
await check('role sync starts disabled and holds no unmanaged grants',async()=>{const p=await service.plan();assert.equal(p.enabled,false);assert.equal(p.totalGrants,0);assert.equal(p.totalRevokes,0)});
await check('unapproved guild cannot be mapped',async()=>{await assert.rejects(()=>service.addMapping({guildId:outside,roleId:employeeRole,sourceKind:'accountType',sourceId:'employee'}),e=>e.code==='DISCORD_GUILD_NOT_APPROVED')});
await check('Administrator Discord role cannot be mapped',async()=>{await assert.rejects(()=>service.addMapping({guildId:guild,roleId:unsafeRole,sourceKind:'accountType',sourceId:'employee'}),e=>e.code==='DISCORD_ROLE_UNSAFE')});
await check('unknown Team and unsupported account types rejected',async()=>{
 await assert.rejects(()=>service.addMapping({guildId:guild,roleId:employeeRole,sourceKind:'team',sourceId:'unknown'}),e=>e.code==='DISCORD_TEAM_NOT_FOUND');
 await assert.rejects(()=>service.addMapping({guildId:guild,roleId:employeeRole,sourceKind:'accountType',sourceId:'administrator'}),e=>e.code==='DISCORD_ACCOUNT_TYPE_INVALID');
});
await check('account type and Team mappings are persisted but not executed while disabled',async()=>{
 await service.addMapping({guildId:guild,roleId:employeeRole,sourceKind:'accountType',sourceId:'employee'});
 await service.addMapping({guildId:guild,roleId:teamRole,sourceKind:'team',sourceId:'team1'});
 assert.equal((await service.plan()).totalGrants,2);
 assert.equal((await service.reconcile()).enabled,false);
 assert.equal(events.length,0);assert.equal(records.length,0);
});
await check('preview ignores expired users and shows only eligible candidates',async()=>{
 const plan=await service.plan();assert.equal(plan.totalGrants,2);assert.equal(plan.totalRevokes,0);
});
await check('opt-in applies eligible grant but never captures pre-existing Discord role',async()=>{
 await service.setEnabled(true);
 const result=await service.reconcile();assert.equal(result.applied,1);assert.equal(result.skipped,1);assert.equal(result.failed,0);
 assert.equal(records.filter(r=>r.status==='managed').length,1);
 assert.equal(records.filter(r=>r.status==='external').length,1);
 assert(memberRoles.get(discordA).has(employeeRole));assert(memberRoles.get(discordB).has(teamRole));
});
await check('lost identity link produces Cluster-owned revoke but no foreign revoke',async()=>{
 users[0].discordUserId=null;
 const plan=await service.plan();assert.equal(plan.totalRevokes,1);
 const result=await service.reconcile();assert.equal(result.applied,1);
 assert(!memberRoles.get(discordA).has(employeeRole));assert(memberRoles.get(discordB).has(teamRole));
});
await check('relinking permits a previously revoked role to be reissued',async()=>{
 users[0].discordUserId=discordA;
 const result=await service.reconcile();assert.equal(result.applied,1);
 assert.equal(records.length,2);assert.equal(records.find(r=>r.discordUserId===discordA).status,'managed');
});
await check('disabled sync does not mutate Discord',async()=>{
 await service.setEnabled(false);users[0].accountState='DISABLED';
 const before=requests.length;const result=await service.reconcile();assert.equal(result.enabled,false);assert.equal(requests.length,before);
});
await check('offboarding revokes only previously granted roles when enabled',async()=>{
 await service.setEnabled(true);const result=await service.reconcile();assert.equal(result.applied,1);assert(!memberRoles.get(discordA).has(employeeRole));
});
await check('mapped role removal does not delete unrelated Discord role',async()=>{
 const mappings=(await service.list(guild)).mappings;
 await service.removeMapping(mappings.find(m=>m.sourceKind==='team').id);
 await service.reconcile();assert(memberRoles.get(discordB).has(teamRole));
});
await check('uncertain grant is not revoked automatically or claimed managed',async()=>{
 // Discord PUT failure must never create a managed record.
 users[0].accountState='ACTIVE';failPut=true;
 let result=await service.reconcile();assert.equal(result.failed,1);
 assert(records.some(r=>r.status==='uncertain'));
 users[0].accountState='DISABLED';result=await service.reconcile();assert.equal(result.applied,0);
 assert(records.some(r=>r.status==='uncertain'));
});
await check('role status exposes ownership counts but not account identities',async()=>{
 const result=await service.list(guild);
 assert.equal(typeof result.managed,'number');assert.equal(typeof result.uncertain,'number');assert(!('users' in result));
});
await check('normal install remains separate from optional Manage Roles install',async()=>{
 const ui=fs.readFileSync(path.join(root,'packages/renderer/src/features/admin/ProductionIntegrationAdminPages.tsx'),'utf8');
 assert(ui.includes('permissions=3072'));assert(ui.includes('permissions=268438528'));
 assert(ui.includes('One-way role synchronization'));
});
await check('role changes are admin-only and preview is read-only',async()=>{
 const server=fs.readFileSync(path.join(root,'apps/server/src/app/server-discord-runtime.ts'),'utf8');
 assert(server.includes('roleProjection.plan()'));
 assert(server.includes('roleProjection.reconcile()'));
 assert(server.includes('requireTool(request, reply, "integrations", "manage")'));
});
console.log(`PASS ${total}/${total} RC43 role projection checks`);
