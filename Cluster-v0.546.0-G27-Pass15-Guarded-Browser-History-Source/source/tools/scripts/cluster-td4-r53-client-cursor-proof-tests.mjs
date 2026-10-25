/** TD4 R53 executable HTTP, SSE, and renderer cursor-proof regressions. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const load=(filename,imports,globals={})=>{
 const js=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 vm.runInNewContext(js,{module:mod,exports:mod.exports,require:key=>{if(!(key in imports))throw Error(`Unmocked ${key}`);return imports[key]},Date,Promise,String,Boolean,Number,BigInt,Array,Object,Map,Set,JSON,Error,Math,URL,setInterval,clearInterval,setTimeout,clearTimeout,process,...globals},{filename});return mod.exports;
};
let assertions=0;
async function check(name,fn){try{await fn();assertions++;console.log('PASS',name)}catch(err){console.error('FAIL',name,err);process.exitCode=1}}
const handlers=new Map();let ids=new Map([[80n,'OLD-80'],[125n,'NEW-125'],[126n,'NEW-126']]);let latest=125n;
const events=[{wireVersion:1,eventSchemaVersion:1,sequence:'126',cursorIdentity:'NEW-126',eventType:'activity.recorded',resource:{kind:'project',id:'P1'},occurredAt:new Date().toISOString()}];
const runtime=load('apps/server/src/domains/changes/resource-change-routes.ts',{
 zod: { z: { object: () => ({ parse: q => q }), coerce: { string: () => ({ regex(){ return this }, optional(){ return this } }) } } },
 '@cluster/shared':{CLUSTER_ACCESS_TARGET_KINDS:['project'],clusterResourceChangesQuerySchema:{parse:q=>({after:String(q.after||'0'),afterIdentity:q.afterIdentity,limit:100})}},
 '../../core/api-response.js':{apiError:()=>({ok:false})},
 '../../core/resource-change-runtime.js':{resourceChangeWindow:async()=>({floor:1n,latest}),readResourceChanges:async(_prisma,after)=>events.filter(e=>BigInt(e.sequence)>after),latestResourceChangeSequence:async()=>latest,resourceChangeSequenceIdentity:async(_prisma,seq)=>ids.get(seq)??null},
 './resource-change-providers.js':{isEnrolledResourceChangeProvider:()=>false,loadResourceChangeProviderSnapshot:async()=>({projectIds:[],requiresAudience:false,requiresLibrary:false,visible:()=>new Set()})},
 './resource-change-tool-lifecycle.js':{enabledResourceChanges:items=>items,resourceChangeToolAvailabilityFingerprint:()=>''},
 '../workforce/workforce-user-authority.js':{WORKFORCE_USER_AUTHORITY_INCLUDE:{}},
 '../access/studio-audience.js':{loadStudioAudienceUserContext:async()=>({})},
 '../planning/calendar-access.js':{canAccessCalendarEvent:async()=>true}
});
const prisma={session:{findUnique:async()=>({id:'S1',userId:'U1',expiresAt:new Date(Date.now()+120_000),user:{id:'U1',accountState:'ACTIVE',authenticationGeneration:1},authenticationGeneration:1})},project:{findMany:async()=>[]},accessRule:{findMany:async()=>[]}};
let unsubscribed=0;
runtime.registerResourceChangeRoutes({app:{get:(route,handler)=>handlers.set(route,handler)},prisma,authorization:{hasTargetAccess:()=>true,hasToolPermission:()=>true},changeRuntime:{subscribe:()=>()=>{unsubscribed++}},libraryAccess:{contextForUser:async()=>({}),visibleFor:()=>true},getCurrentSession:async()=>({id:'S1',userId:'U1'}),decorateUserForClient:async()=>({isAdmin:true,workspaceRole:'admin'}),isConfigurableToolEnabled:()=>true});
async function get(query){return handlers.get('/api/changes')({query,raw:{}},{header(){return this}})}
function stream(query){const frames=[],responseHandlers={};const raw={destroyed:false,writableEnded:false,writableLength:0,setHeader(){},flushHeaders(){},once:(name,fn)=>{responseHandlers[name]=fn},write:frame=>{frames.push(frame);return true},end(){this.writableEnded=true;responseHandlers.finish?.()}};return {frames,raw,start:()=>handlers.get('/api/changes/stream')({query,raw:{once(){} }},{raw,hijack(){}}),close:()=>{raw.end()}}}
await check('HTTP matching cursor proof allows incremental replay',async()=>{latest=126n;const output=await get({after:'125',afterIdentity:'NEW-125'});assert.equal(output.resetRequired,false);assert.equal(output.changes.length,1);assert.equal(output.cursorIdentity,'NEW-126')});
await check('HTTP restored identity resets even when outbox overtakes cursor',async()=>{latest=126n;ids.set(125n,'RESTORED-125');const output=await get({after:'125',afterIdentity:'NEW-125'});assert.equal(output.resetRequired,true);assert.equal(output.resetReason,'history_replaced');assert.equal(output.cursor,'126');assert.equal(output.cursorIdentity,'NEW-126');assert.equal(output.changes.length,0)});
await check('HTTP cursor with no proof remains compatible but reports new proof',async()=>{const output=await get({after:'125'});assert.equal(output.resetRequired,false);assert.equal(output.cursorIdentity,'NEW-126')});
await check('SSE reconnect rejects replaced history and provides authoritative cursor proof',async()=>{const s=stream({after:'125',afterIdentity:'NEW-125'});await s.start();assert.ok(s.frames.some(f=>f.includes('event: reset')&&f.includes('history_replaced')));assert.ok(s.frames.some(f=>f.includes('event: ready')&&f.includes('NEW-126')));s.close()});
await check('SSE current cursor resumes without false reset',async()=>{const s=stream({after:'126',afterIdentity:'NEW-126'});await s.start();assert.ok(!s.frames.some(f=>f.includes('event: reset')));s.close()});
await check('SSE rejected stored cursor never becomes an unvalidated replay cursor',async()=>{const s=stream({after:'125',afterIdentity:'FORGED-125'});await s.start();assert.ok(s.frames.some(f=>f.includes('history_replaced')));assert.ok(s.frames.find(f=>f.includes('event: ready')).includes('"cursor":"126"'));s.close()});
await check('renderer persists cursor and proof atomically and sends proof on reconnect',async()=>{
 const calls=[],store=new Map(),listeners=[],mounts=[];class FakeEventSource{constructor(url){this.url=url;this.callbacks=new Map();this.closed=false;calls.push(this)} addEventListener(k,v){this.callbacks.set(k,v)}emit(k,p){this.callbacks.get(k)({data:JSON.stringify(p)})}close(){this.closed=true}}
 const win={location:{origin:'https://cluster.local'},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},addEventListener(){},removeEventListener(){},setTimeout(){return 1},clearTimeout(){}};
 const doc={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 const hook=load('packages/renderer/src/features/application/use-resource-change-invalidation.ts',{
 react:{useEffect:fn=>mounts.push(fn)},'@cluster/shared':{clusterResourceChangeSchema:{safeParse:v=>({success:true,data:v})}},'../../core/api':{API_URL:'',invalidateApiQueries(){}},'../../core/offline-runtime-shell':{refreshOfflineSyncState:async()=>{}},'../../core/resource-change-client':{applyResourceChangeInvalidation(){},emitResourceChangeFeedReset(){}},'../../core/reconnect-backoff':{reconnectBackoffDelay:()=>1000}
 },{window:win,document:doc,navigator:{onLine:true},EventSource:FakeEventSource});
 hook.useResourceChangeInvalidation('U1');let cleanup=mounts[0]();assert.equal(calls.length,1);calls[0].emit('ready',{cursor:'125',cursorIdentity:'NEW-125'});assert.equal(store.get('cluster-resource-change-cursor:U1'),'125');assert.equal(store.get('cluster-resource-change-cursor-identity:U1'),'NEW-125');cleanup();
 hook.useResourceChangeInvalidation('U1');cleanup=mounts[1]();assert.ok(calls[1].url.includes('after=125'));assert.ok(calls[1].url.includes('afterIdentity=NEW-125'));
 calls[1].emit('reset',{reason:'history_replaced',cursor:'126',cursorIdentity:'NEW-126'});assert.equal(store.get('cluster-resource-change-cursor-identity:U1'),'NEW-126');
 calls[1].emit('change',{sequence:'127',resource:{kind:'project',id:'P1'},cursorIdentity:'NEW-127'});assert.equal(store.get('cluster-resource-change-cursor-identity:U1'),'NEW-127');
 calls[1].emit('reset',{reason:'cursor_ahead',cursor:'0'});assert.equal(store.get('cluster-resource-change-cursor:U1'),'0');assert.equal(store.has('cluster-resource-change-cursor-identity:U1'),false);cleanup();
});
console.log(`${assertions}/${assertions} TD4 R53 client continuity tests passed`);
