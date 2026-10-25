import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
function load(file,dependencies){
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 vm.runInNewContext(code,{module:mod,exports:mod.exports,require:id=>{if(!(id in dependencies))throw Error(`Unmocked ${id}`);return dependencies[id]},console,process,Date,Promise,Number,Math,String,Boolean,BigInt,JSON,Error,Array,Map,Set,Object,setInterval,clearInterval,setTimeout,clearTimeout,queueMicrotask},{filename:file});
 return mod.exports;
}
let checks=0;
async function check(name,callback){try{await callback();checks++;console.log('PASS',name)}catch(error){console.error('FAIL',name,error);process.exitCode=1}}
const runtimeModule=load('apps/server/src/core/resource-change-runtime.ts',{'@cluster/shared':{CLUSTER_RESOURCE_CHANGE_WIRE_VERSION:1,clusterResourceChangeSchema:{safeParse:v=>({success:v.wireVersion===1&&v.resource.kind==='project',data:v})}}});
let latest=100n,auditFails=false;const rows=[];
const db={domainEventOutbox:{aggregate:async()=>{if(auditFails)throw Error('database unavailable');return {_max:{sequence:latest}}},findMany:async({where,take})=>rows.filter(row=>row.sequence>where.sequence.gt).slice(0,take),findUnique:async({where})=>({id:`event-${where.sequence.toString()}`})}};
const runtime=new runtimeModule.ResourceChangeRuntime(db,{}, {cursorAuditMs:1000});
const delivered=[],resets=[];const unsubscribe=runtime.subscribe(batch=>delivered.push(...batch),reset=>resets.push(reset));
await runtime.initialize();runtime.started=true;
await check('startup uses outbox high water mark',()=>assert.equal(runtime.snapshot().cursor,'100'));
await check('healthy poll does not invent reset',async()=>{await runtime.poll();assert.equal(resets.length,0)});
await check('in-place database restore rewinds server cursor and resets subscribers',async()=>{
 latest=20n;runtime.nextCursorAuditAt=0;await runtime.poll();assert.equal(runtime.snapshot().cursor,'20');assert.equal(resets.length,1);assert.equal(resets[0].cursor,'20');assert.equal(resets[0].reason,'cursor_ahead');assert.equal(runtime.snapshot().cursorRewinds,1);assert.ok(runtime.snapshot().lastCursorRewindAt);
});
const row=sequence=>({sequence,type:'activity.recorded',schemaVersion:1,resourceKind:'project',resourceId:'P1',resourceProjectId:null,resourceRevision:null,occurredAt:new Date('2026-10-15T00:00:00Z')});
await check('events after restore flow normally',async()=>{latest=21n;rows.push(row(21n));await runtime.poll();assert.equal(delivered.at(-1).sequence,'21');assert.equal(runtime.snapshot().cursor,'21')});
await check('empty restored history also recovers',async()=>{latest=0n;rows.length=0;runtime.nextCursorAuditAt=0;await runtime.poll();assert.equal(resets.at(-1).cursor,'0');latest=1n;rows.push(row(1n));await runtime.poll();assert.equal(delivered.at(-1).sequence,'1')});
await check('failed audit is retried without adopting an unverified cursor',async()=>{auditFails=true;runtime.nextCursorAuditAt=0;const cursor=runtime.snapshot().cursor;await runtime.poll();assert.equal(runtime.snapshot().cursor,cursor);assert.equal(runtime.nextCursorAuditAt,0);auditFails=false;latest=0n;rows.length=0;await runtime.poll();assert.equal(runtime.snapshot().cursor,'0')});
await check('unsubscribe prevents further reset callbacks',async()=>{unsubscribe();const n=resets.length;runtime.cursor=15n;latest=1n;runtime.nextCursorAuditAt=0;await runtime.poll();assert.equal(resets.length,n);assert.equal(runtime.snapshot().listeners,0)});
await check('a failing reset subscriber cannot block another subscription',async()=>{
 const received=[];
 const removeBad=runtime.subscribe(()=>{},()=>{throw Error('subscriber failed')});
 const removeGood=runtime.subscribe(()=>{},reset=>received.push(reset));
 runtime.cursor=40n;latest=2n;runtime.nextCursorAuditAt=0;await runtime.reconcileRestoredCursor();
 assert.equal(received.length,1);assert.equal(received[0].cursor,'2');
 removeBad();removeGood();
});
runtime.draining=true;runtime.started=false;if(runtime.timer)clearTimeout(runtime.timer);
const handlers=new Map();let sendReset,unsubscribed=0;
const route=load('apps/server/src/domains/changes/resource-change-routes.ts',{
 zod:{z:{object:()=>({parse:q=>q}),coerce:{string:()=>({regex(){return this},optional(){return this}})}}},
 '@cluster/shared':{CLUSTER_ACCESS_TARGET_KINDS:['project'],clusterResourceChangesQuerySchema:{parse:q=>({after:String(q.after||'0'),limit:100})}},
 '../../core/api-response.js':{apiError:()=>({ok:false})},
 '../../core/resource-change-runtime.js':{resourceChangeWindow:async()=>({floor:1n,latest:10n}),readResourceChanges:async()=>[],resourceChangeSequenceIdentity: async (_db, sequence) => sequence > 0n ? `test-${sequence.toString()}` : null, latestResourceChangeSequence:async()=>10n},
 './resource-change-providers.js':{isEnrolledResourceChangeProvider:()=>false,loadResourceChangeProviderSnapshot:async()=>({projectIds:[],requiresAudience:false,requiresLibrary:false,visible:()=>new Set()})},
 './resource-change-tool-lifecycle.js':{enabledResourceChanges:xs=>xs,resourceChangeToolAvailabilityFingerprint:()=>''},
 '../workforce/workforce-user-authority.js':{WORKFORCE_USER_AUTHORITY_INCLUDE:{}},
 '../access/studio-audience.js':{loadStudioAudienceUserContext:async()=>({})},
 '../planning/calendar-access.js':{canAccessCalendarEvent:async()=>true},
});
const prisma={session:{findUnique:async()=>({id:'S1',userId:'U1',revokedAt:null,expiresAt:new Date(Date.now()+60000),authenticationGeneration:1,user:{id:'U1',accountState:'ACTIVE',authenticationGeneration:1}})},project:{findMany:async()=>[]},accessRule:{findMany:async()=>[]}};
route.registerResourceChangeRoutes({app:{get:(path,cb)=>handlers.set(path,cb)},prisma,getCurrentSession:async()=>({id:'S1',userId:'U1'}),decorateUserForClient:async()=>({isAdmin:true,workspaceRole:'admin'}),authorization:{hasTargetAccess:()=>true,hasToolPermission:()=>true},libraryAccess:{contextForUser:async()=>({}),visibleFor:()=>true},changeRuntime:{subscribe:(_batch,reset)=>{sendReset=reset;return()=>{unsubscribed++}}},isConfigurableToolEnabled:()=>true});
await check('SSE restore reset ends response and immediately cleans up subscription',async()=>{
 const frames=[],responseHandlers={};const raw={destroyed:false,writableEnded:false,writableLength:0,setHeader(){},flushHeaders(){},once:(name,cb)=>{responseHandlers[name]=cb},write:frame=>{frames.push(frame);return true},end(){this.writableEnded=true;responseHandlers.finish?.()}};
 const reqHandlers={};await handlers.get('/api/changes/stream')({query:{after:'10'},raw:{once:(name,cb)=>{reqHandlers[name]=cb}}},{raw,hijack(){}});
 assert.equal(typeof sendReset,'function');await sendReset({reason:'cursor_ahead',cursor:'3'});
 assert.equal(raw.writableEnded,true);assert.ok(frames.some(f=>f.includes('event: reset')&&f.includes('"cursor":"3"')));assert.equal(unsubscribed,1);reqHandlers.close?.();assert.equal(unsubscribed,1);
});
if(process.exitCode)process.exit(process.exitCode);
console.log(`${checks}/9 TD4 R52 live restore checks passed`);
