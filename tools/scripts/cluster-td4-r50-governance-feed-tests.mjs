/** TD4 R50 executable route/provider authorization tests; no production DB. */
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
const records={announcements:[],policies:[],assignments:[],users:[],teams:[],departments:[],roles:[]};
let role='member', peopleLevel='view', failPeople=false, failAudience=false, failPolicy=false, failAnnouncement=false, failAssignment=false, expired=false, revoked=false;
let teams=[],employment={departmentId:'D1',jobRoleId:'R1',active:true};
const user={id:'U1',accountState:'ACTIVE',archived:false,authenticationGeneration:1};
const prisma={
 session:{findUnique:async()=>({id:'S1',userId:'U1',revokedAt:revoked?new Date():null,expiresAt:new Date(Date.now()+(expired?-1:60000)),authenticationGeneration:1,user})},
 project:{findMany:async()=>[]},accessRule:{findMany:async()=>[]},
 user:{findMany:async({where})=>{if(failPeople)throw Error('people database down');return records.users.filter(r=>where.id.in.includes(r.id))}},
 studioTeam:{findMany:async({where})=>{if(failPeople)throw Error('people database down');return records.teams.filter(r=>where.id.in.includes(r.id))}},
 department:{findMany:async({where})=>{if(failPeople)throw Error('people database down');return records.departments.filter(r=>where.id.in.includes(r.id))}},
 jobRole:{findMany:async({where})=>{if(failPeople)throw Error('people database down');return records.roles.filter(r=>where.id.in.includes(r.id))}},
 studioAnnouncement:{findMany:async({where})=>{if(failAnnouncement)throw Error('announcement database down');return records.announcements.filter(r=>where.id.in.includes(r.id))}},
 studioPolicy:{findMany:async({where})=>{if(failPolicy)throw Error('policy database down');return records.policies.filter(r=>where.id.in.includes(r.id))}},
 studioOnboardingAssignment:{findMany:async({where})=>{if(failAssignment)throw Error('assignment database down');return records.assignments.filter(r=>where.id.in.includes(r.id))}},
 employment:{findUnique:async()=>{if(failAudience) throw Error('employment unavailable');return employment}},
 studioTeamMember:{findMany:async()=>{if(failAudience) throw Error('team unavailable');return teams}},
 projectMembership:{findMany:async()=>{if(failAudience) throw Error('membership unavailable');return []}},
 calendarEvent:{findMany:async()=>[]},card:{findMany:async()=>[]},
};
const changes=[];let latest=0n;
const auth={hasTargetAccess:()=>true,hasToolPermission:(_user,_role,tool,level)=>tool==='settings'?role==='admin'&&level==='edit':tool==='people'? peopleLevel==='manage'||(peopleLevel==='view'&&level==='view'):true};
const handlers={};
const zString={regex(){return this},optional(){return this}};
const routes=load('apps/server/src/domains/changes/resource-change-routes.ts',{
 'zod':{z:{object:()=>({parse:q=>q}),coerce:{string:()=>zString}}},
 '@cluster/shared':{CLUSTER_ACCESS_TARGET_KINDS:['project','library','policy','announcement'],clusterResourceChangesQuerySchema:{parse:q=>({after:String(q.after??0),limit:Number(q.limit??100)})}},
 '../../core/api-response.js':{apiError:(_r,reply,status,code)=>{reply.code(status);return {ok:false,code}}},
 '../../core/resource-change-runtime.js':{resourceChangeWindow:async()=>({floor:0n,latest}),readResourceChanges:async(_db,after,limit)=>changes.filter(x=>BigInt(x.sequence)>after).slice(0,limit),resourceChangeSequenceIdentity: async (_db, sequence) => sequence > 0n ? `test-${sequence.toString()}` : null, latestResourceChangeSequence:async()=>latest},
 './resource-change-providers.js':providers,
 './resource-change-tool-lifecycle.js':{enabledResourceChanges:(changes)=>changes,resourceChangeToolAvailabilityFingerprint:()=>'all-enabled'},
 '../access/studio-audience.js':audience,
 '../workforce/workforce-user-authority.js':{WORKFORCE_USER_AUTHORITY_INCLUDE:{}},
 '../planning/calendar-access.js':{canAccessCalendarEvent:()=>true},
});
routes.registerResourceChangeRoutes({
 app:{get:(url,fn)=>handlers[url]=fn},prisma,authorization:auth,
 libraryAccess:{contextForUser:async()=>({user}),visibleFor:()=>true},
 getCurrentSession:async()=>({id:'S1',userId:'U1'}),decorateUserForClient:async()=>({workspaceRole:role,isAdmin:role==='admin'}),
 isConfigurableToolEnabled:()=>true,changeRuntime:{subscribe:()=>()=>{}},
});
const event=(kind,id,projectId)=>({sequence:'1',eventType:'resource.updated',resource:{kind,id,...(projectId?{projectId}:{})},occurredAt:'2026-10-15T12:00:00Z'});
async function read(kind,id,projectId){changes.splice(0,changes.length,event(kind,id,projectId));latest=1n;
 const reply={code(){return this},header(){return this}};
 const result=await handlers['/api/changes']({query:{after:'0'},raw:{}},reply);
 return Array.from(result.changes || [], x=>x.resource.id);
}
const all={mode:'all',targets:[]};
const mine={mode:'include',targets:[{kind:'user',id:'U1'}]};
const other={mode:'include',targets:[{kind:'user',id:'U2'}]};
const excludedTeam={mode:'exclude',targets:[{kind:'team',id:'T1'}]};
const published=[{id:'V1'}];
const announcement=(id,audienceJson=all,extra={})=>({id,status:'published',audienceJson:JSON.stringify(audienceJson),...extra});
const policy=(id,audienceJson=all,extra={})=>({id,status:'active',audienceJson:JSON.stringify(audienceJson),versions:published,...extra});
const assignment=(id,userId,extra={})=>({id,userId,planVersion:{status:'published',plan:{status:'active'}},...extra});
records.users=[{id:'U1',archived:false,accountState:'ACTIVE'}, {id:'U2',archived:false,accountState:'ACTIVE'}, {id:'U3',archived:true,accountState:'ACTIVE'}, {id:'U4',archived:false,accountState:'PRIVACY_ERASED'}];
records.teams=[{id:'T1',archived:false},{id:'T2',archived:true}];
records.departments=[{id:'D1',archived:false},{id:'D2',archived:true}];
records.roles=[{id:'R1',archived:false},{id:'R2',archived:true}];
records.announcements=[announcement('A-ALL'),announcement('A-MINE',mine),announcement('A-OTHER',other),announcement('A-DRAFT',all,{status:'draft'}),announcement('A-EXCLUDE',excludedTeam)];
records.policies=[policy('P-MINE',mine),policy('P-OTHER',other),policy('P-DRAFT',all,{status:'draft'}),policy('P-NOVERSION',all,{versions:[]}),policy('P-EXCLUDE',excludedTeam),policy('P-INVALID',all,{audienceJson:'{invalid'})];
records.assignments=[assignment('ON-MINE','U1'),assignment('ON-OTHER','U2'),assignment('ON-REVOKED','U1',{status:'revoked'}),assignment('ON-DRAFT','U1',{planVersion:{status:'draft',plan:{status:'active'}}}),assignment('ON-INACTIVE','U1',{planVersion:{status:'published',plan:{status:'archived'}}})];
let checks=0;
async function check(label,fn){try{await fn();checks++;console.log('PASS',label)}catch(e){console.error('FAIL',label,e);process.exitCode=1}}
await check('People identities share the same provider registry',()=>{for(const kind of ['user','team','department','job_role'])assert.equal(providers.isEnrolledResourceChangeProvider(kind),true)});
await check('live user identity is valid for People viewer',async()=>assert.deepEqual(await read('user','U2'),['U2']));
await check('archived users are restricted to People managers',async()=>assert.deepEqual(await read('user','U3'),[]));
await check('privacy erased identity cannot leak even to admin',async()=>{role='admin';peopleLevel='manage';assert.deepEqual(await read('user','U4'),[]);role='member';peopleLevel='view'});
await check('self identity remains visible without People directory access',async()=>{peopleLevel='none';assert.deepEqual(await read('user','U1'),['U1']);assert.deepEqual(await read('user','U2'),[]);peopleLevel='view'});
await check('People directory viewers may read active teams departments and job roles',async()=>{for(const [kind,id] of [['team','T1'],['department','D1'],['job_role','R1']])assert.deepEqual(await read(kind,id),[id])});
await check('archived People organization entries require manage grant',async()=>{for(const [kind,id] of [['team','T2'],['department','D2'],['job_role','R2']])assert.deepEqual(await read(kind,id),[])});
await check('People manage grant admits archived directory invalidations',async()=>{peopleLevel='manage';for(const [kind,id] of [['user','U3'],['team','T2'],['department','D2'],['job_role','R2']])assert.deepEqual(await read(kind,id),[id]);peopleLevel='view'});
await check('People identities never accept Project envelope spoofing',async()=>{for(const [kind,id] of [['user','U2'],['team','T1'],['department','D1'],['job_role','R1']])assert.deepEqual(await read(kind,id,'P-FORGED'),[])});
await check('unknown People identities never broadcast',async()=>{for(const kind of ['user','team','department','job_role'])assert.deepEqual(await read(kind,'NOT-REAL'),[])});
await check('People lookup outage fails closed before event emission',async()=>{failPeople=true;await assert.rejects(read('team','T1'),/people database down/);failPeople=false});
await check('governance kinds enrolled in single canonical provider registry',()=>{for(const kind of ['announcement','policy','onboarding_assignment'])assert.equal(providers.isEnrolledResourceChangeProvider(kind),true)});
await check('published Studio-wide announcement admitted',async()=>assert.deepEqual(await read('announcement','A-ALL'),['A-ALL']));
await check('targeted announcement admitted only to matching user',async()=>assert.deepEqual(await read('announcement','A-MINE'),['A-MINE']));
await check('other-user announcement excluded',async()=>assert.deepEqual(await read('announcement','A-OTHER'),[]));
await check('draft announcement excluded',async()=>assert.deepEqual(await read('announcement','A-DRAFT'),[]));
await check('missing announcement denied',async()=>assert.deepEqual(await read('announcement','A-MISSING'),[]));
await check('published targeted policy admitted',async()=>assert.deepEqual(await read('policy','P-MINE'),['P-MINE']));
await check('another audience policy is hidden',async()=>assert.deepEqual(await read('policy','P-OTHER'),[]));
await check('draft and unversioned policies hidden',async()=>{for(const id of ['P-DRAFT','P-NOVERSION'])assert.deepEqual(await read('policy',id),[])});
await check('malformed policy audience never falls back to everyone',async()=>assert.deepEqual(await read('policy','P-INVALID'),[]));
await check('own onboarding assignment admitted',async()=>assert.deepEqual(await read('onboarding_assignment','ON-MINE'),['ON-MINE']));
await check('another persons assignment hidden',async()=>assert.deepEqual(await read('onboarding_assignment','ON-OTHER'),[]));
await check('revoked own assignment can invalidate a stale client list',async()=>assert.deepEqual(await read('onboarding_assignment','ON-REVOKED'),['ON-REVOKED']));
await check('draft onboarding plan version cannot leak',async()=>assert.deepEqual(await read('onboarding_assignment','ON-DRAFT'),[]));
await check('inactive onboarding plan excluded',async()=>assert.deepEqual(await read('onboarding_assignment','ON-INACTIVE'),[]));
await check('invalid claimed Project context rejected on unscoped resources',async()=>{for(const [kind,id] of [['announcement','A-ALL'],['policy','P-MINE'],['onboarding_assignment','ON-MINE']])assert.deepEqual(await read(kind,id,'PROJECT-FORGED'),[])});
await check('excluded team members cannot see excluded broadcasts',async()=>{teams=[{teamId:'T1'}];assert.deepEqual(await read('announcement','A-EXCLUDE'),[]);assert.deepEqual(await read('policy','P-EXCLUDE'),[]);teams=[]});
await check('audience query failure cannot invert exclusions',async()=>{failAudience=true;await assert.rejects(read('announcement','A-EXCLUDE'),/unavailable/);await assert.rejects(read('policy','P-EXCLUDE'),/unavailable/);failAudience=false});
await check('administrator may see draft records but not fabricated IDs',async()=>{role='admin';try {for(const [kind,id] of [['announcement','A-DRAFT'],['policy','P-DRAFT'],['onboarding_assignment','ON-OTHER']])assert.deepEqual(await read(kind,id),[id]);for(const kind of ['announcement','policy','onboarding_assignment'])assert.deepEqual(await read(kind,'NOT-REAL'),[])}finally{role='member'}});
await check('revoked session or expired account cannot read governance IDs',async()=>{revoked=true;assert.deepEqual(await read('announcement','A-ALL'),[]);revoked=false;expired=true;assert.deepEqual(await read('onboarding_assignment','ON-MINE'),[]);expired=false});
await check('announcement database outage never turns into a grant',async()=>{failAnnouncement=true;await assert.rejects(read('announcement','A-ALL'),/database down/);failAnnouncement=false});
await check('policy database outage never turns into a grant',async()=>{failPolicy=true;await assert.rejects(read('policy','P-MINE'),/database down/);failPolicy=false});
await check('assignment database outage never turns into a grant',async()=>{failAssignment=true;await assert.rejects(read('onboarding_assignment','ON-MINE'),/database down/);failAssignment=false});
if(!process.exitCode)console.log(`${checks}/${checks} R50 governance change-feed checks passed`);
