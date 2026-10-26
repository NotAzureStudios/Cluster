/** TD4 R45: actual route -> provider -> Studio audience / Library policy, mocked Prisma boundaries. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const source=(name)=>ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(name, mocks){const mod={exports:{}};vm.runInNewContext(source(name),{
 module:mod,exports:mod.exports,require:(name)=>{if(!(name in mocks)) throw new Error(`Unmocked ${name}`);return mocks[name]},
 console,process,Date,Map,Set,Promise,Number,Math,String,Boolean,BigInt,JSON,Error,Array,setInterval,clearInterval,
});return mod.exports}
const audience=load('apps/server/src/domains/access/studio-audience.ts',{'@cluster/shared':{studioAudienceSchema:{parse:v=>v}}});
const providers=load('apps/server/src/domains/changes/resource-change-providers.ts',{
 '../access/studio-audience.js':audience,
});
const records={forms:[],submissions:[],packets:[]};
let role='member', packetsTool=true, settingsEdit=false, libraryVisible=true, failAudience=false, failPacketAcl=false, expired=false, revoked=false, active=true;
let memberships=[],teams=[],employment={departmentId:'D1',jobRoleId:'R1',active:true};
const user={id:'U1',accountState:'ACTIVE',archived:false,authenticationGeneration:1};
const prisma={
 session:{findUnique:async()=>({id:'S1',userId:'U1',revokedAt:revoked?new Date():null,expiresAt:new Date(Date.now()+(expired?-1:60000)),authenticationGeneration:1,user:active?user:{...user,accountState:'SUSPENDED'}})},
 project:{findMany:async()=>[]},accessRule:{findMany:async()=>[]},
 studioForm:{findMany:async({where})=>records.forms.filter(r=>where.id.in.includes(r.id))},
 studioFormSubmission:{findMany:async({where})=>records.submissions.filter(r=>where.id.in.includes(r.id))},
 packetDefinition:{findMany:async({where})=>records.packets.filter(r=>where.libraryFolderId.in.includes(r.libraryFolderId))},
 libraryItem:{findMany:async()=>[]}, personnelRecordAttachment:{findMany:async()=>[]},
 employment:{findUnique:async()=>{if(failAudience) throw Error('employment unavailable');return employment}},
 studioTeamMember:{findMany:async()=>{if(failAudience) throw Error('team unavailable');return teams}},
 projectMembership:{findMany:async()=>{if(failAudience) throw Error('project memberships unavailable');return memberships}},
 calendarEvent:{findMany:async()=>[]},card:{findMany:async()=>[]},
};
const changes=[];let latest=0n;
const auth={
 hasTargetAccess:()=>true,
 hasToolPermission:(_user,_role,tool,level)=>tool==='settings' ? (settingsEdit || role==='admin') && level==='edit' : tool==='packets'?packetsTool:true,
};
const handlers={};
const zString={regex(){return this},optional(){return this}};
const routes=load('apps/server/src/domains/changes/resource-change-routes.ts',{
 'zod':{z:{object:()=>({parse:q=>q}),coerce:{string:()=>zString}}},
 '@cluster/shared':{CLUSTER_ACCESS_TARGET_KINDS:['project','library','board'],clusterResourceChangesQuerySchema:{parse:q=>({after:String(q.after??0),limit:Number(q.limit??100)})}},
 '../../core/api-response.js':{apiError:(_r,reply,status,code)=>{reply.code(status);return {ok:false,code}}},
 '../../core/resource-change-runtime.js':{resourceChangeWindow:async()=>({floor:0n,latest}),readResourceChanges:async(_db,after,limit)=>changes.filter(x=>BigInt(x.sequence)>after).slice(0,limit),resourceChangeSequenceIdentity: async (_db, sequence) => sequence > 0n ? `test-${sequence.toString()}` : null, latestResourceChangeSequence:async()=>latest},
 './resource-change-providers.js':providers,
 './resource-change-tool-lifecycle.js':{enabledResourceChanges:(changes,isEnabled)=>changes,resourceChangeToolAvailabilityFingerprint:()=>"all-enabled"},
 '../access/studio-audience.js':audience,
 '../workforce/workforce-user-authority.js':{WORKFORCE_USER_AUTHORITY_INCLUDE:{}},
 '../planning/calendar-access.js':{canAccessCalendarEvent:()=>true},
});
routes.registerResourceChangeRoutes({
 app:{get:(url,fn)=>handlers[url]=fn},prisma,authorization:auth,
 libraryAccess:{contextForUser:async()=>{if(failPacketAcl) throw Error('ACL unavailable');return {user}},visibleFor:()=>libraryVisible},
 getCurrentSession:async()=>({id:'S1',userId:'U1'}),decorateUserForClient:async()=>({workspaceRole:role,isAdmin:role==='admin'}),
 isConfigurableToolEnabled:()=>true,changeRuntime:{subscribe:()=>()=>{}},
});
const include=(kind,id,projectId)=>({sequence:'1',eventType:'resource.updated',resource:{kind,id,...(projectId?{projectId}:{})},occurredAt:'2026-10-14T22:00:00Z'});
async function read(kind,id,projectId){changes.splice(0,changes.length,include(kind,id,projectId));latest=1n;
 const reply={code(){return this},header(){return this}};
 const result=await handlers['/api/changes']({query:{after:'0'},raw:{}},reply);
 return Array.from(result.changes || [], x=>x.resource.id);
}
const all={mode:'all',targets:[]};
const userAudience={mode:'include',targets:[{kind:'user',id:'U1'}]};
const otherAudience={mode:'include',targets:[{kind:'user',id:'U2'}]};
const excludeAudience={mode:'exclude',targets:[{kind:'team',id:'T1'}]};
const published=[{id:'V1'}];
const form=(id,audienceJson=all,options={})=>({id,status:'active',purpose:'general',audienceJson:JSON.stringify(audienceJson),versions:published,...options});
records.forms=[form('F1',userAudience),form('F2',otherAudience),form('F3',all,{status:'draft'}),form('F4',all,{purpose:'application'}),form('F5',all,{versions:[]}),form('F6',excludeAudience)];
records.submissions=[
 {id:'S-OWN',userId:'U1',formId:'F1',form:records.forms[0]},
 {id:'S-OTHER',userId:'U2',formId:'F1',form:records.forms[0]},
 {id:'S-APPLICATION',userId:null,formId:'F4',form:records.forms[3]},
 {id:'S-RESTRICTED',userId:'U1',formId:'F2',form:records.forms[1]},
];
records.packets=[
 {libraryFolderId:'P-OK',audienceJson:JSON.stringify(userAudience),libraryFolder:{id:'P-OK',type:'folder',status:'active'}},
 {libraryFolderId:'P-OTHER',audienceJson:JSON.stringify(otherAudience),libraryFolder:{id:'P-OTHER',type:'folder',status:'active'}},
 {libraryFolderId:'P-ARCHIVED',audienceJson:JSON.stringify(all),libraryFolder:{id:'P-ARCHIVED',type:'folder',status:'archived'}},
];
let checks=0;
async function check(label,fn){try{await fn();checks++;console.log('PASS',label)}catch(e){console.error('FAIL',label,e);process.exitCode=1}}
await check('enrollment includes three privacy-sensitive providers',()=>{for(const kind of ['studio_form','form_submission','packet','application'])assert.equal(providers.isEnrolledResourceChangeProvider(kind),true)});
await check('active targeted form visible to audience member',async()=>assert.deepEqual(await read('studio_form','F1'),['F1']));
await check('non-audience and draft forms do not leak identifiers',async()=>{for(const id of ['F2','F3','F4','F5','F-NONE'])assert.equal((await read('studio_form',id)).length,0)});
await check('own submitted form visible',async()=>assert.deepEqual(await read('form_submission','S-OWN'),['S-OWN']));
await check('other-user and public application submissions are private',async()=>{for(const id of ['S-OTHER','S-APPLICATION','S-RESTRICTED','S-FAKE']) assert.equal((await read('form_submission',id)).length,0)});
await check('audience revocation immediately removes own submission invalidation',async()=>{records.submissions[0].form=records.forms[1];assert.equal((await read('form_submission','S-OWN')).length,0);records.submissions[0].form=records.forms[0]});
await check('packet needs audience, Tool grant and Library ACL',async()=>{assert.deepEqual(await read('packet','P-OK'),['P-OK']);packetsTool=false;assert.equal((await read('packet','P-OK')).length,0);packetsTool=true;libraryVisible=false;assert.equal((await read('packet','P-OK')).length,0);libraryVisible=true});
await check('packet audience, lifecycle and missing identity prevent invalidation',async()=>{for(const id of ['P-OTHER','P-ARCHIVED','P-NONE'])assert.equal((await read('packet',id)).length,0)});
await check('injected Project parent denied on global resources',async()=>{for(const kindId of [['studio_form','F1'],['form_submission','S-OWN'],['packet','P-OK']])assert.equal((await read(...kindId,'FORGED')).length,0)});
await check('admins can see draft forms/applications but must prove records exist',async()=>{role='admin';for(const [kind,id] of [['studio_form','F3'],['form_submission','S-APPLICATION']])assert.deepEqual(await read(kind,id),[id]);for(const [kind,id] of [['studio_form','MISSING'],['form_submission','MISSING'],['packet','MISSING']])assert.equal((await read(kind,id)).length,0);role='member'});
await check('admins still cannot see deleted/archived Packet',async()=>{role='admin';assert.equal((await read('packet','P-ARCHIVED')).length,0);role='member'});
await check('public application identity is restricted to Studio reviewers',async()=>{
  const original=prisma.studioFormSubmission.findMany;
  prisma.studioFormSubmission.findMany=async({where})=>where.form?.purpose==='application'
    ? records.submissions.filter(row=>row.id==='S-APPLICATION' && where.id.in.includes(row.id))
    : original({where});
  try {
    assert.equal((await read('application','S-APPLICATION')).length,0);
    role='admin';assert.deepEqual(await read('application','S-APPLICATION'),['S-APPLICATION']);
    assert.equal((await read('application','S-OTHER')).length,0);
  } finally {role='member';prisma.studioFormSubmission.findMany=original}
});
await check('invalid Studio audience metadata never defaults to everyone',async()=>{
  const formRow=records.forms[0],packetRow=records.packets[0];
  const oldForm=formRow.audienceJson,oldPacket=packetRow.audienceJson;
  try {
    formRow.audienceJson='{invalid';packetRow.audienceJson='{invalid';
    assert.equal((await read('studio_form','F1')).length,0);
    assert.equal((await read('packet','P-OK')).length,0);
    formRow.audienceJson=JSON.stringify({mode:'include',targets:[]});
    assert.equal((await read('studio_form','F1')).length,0);
  } finally {formRow.audienceJson=oldForm;packetRow.audienceJson=oldPacket}
});
await check('strict audience lookup fails closed on database outage',async()=>{failAudience=true;await assert.rejects(read('studio_form','F1'),/unavailable/);failAudience=false});
await check('strict Packet ACL lookup fails closed',async()=>{failPacketAcl=true;await assert.rejects(read('packet','P-OK'),/ACL unavailable/);failPacketAcl=false});
await check('exclusion-based audience rejects members currently in excluded team',async()=>{teams=[{teamId:'T1'}];assert.equal((await read('studio_form','F6')).length,0);teams=[];assert.deepEqual(await read('studio_form','F6'),['F6'])});
await check('expired or suspended account loses access',async()=>{expired=true;assert.equal((await read('studio_form','F1')).length,0);expired=false;active=false;assert.equal((await read('packet','P-OK')).length,0);active=true});
await check('failed membership lookup must not invert exclusion into a grant',async()=>{failAudience=true;await assert.rejects(read('studio_form','F6'),/unavailable/);failAudience=false});
if(!process.exitCode)console.log(`${checks}/${checks} R45 studio provider checks passed`);
