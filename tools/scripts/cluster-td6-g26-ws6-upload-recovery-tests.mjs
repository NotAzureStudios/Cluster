#!/usr/bin/env node
/** G26 WS6: execute actual read-only operator recovery projection and route. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS G26 WS6 '+name);}
function load(file,mocks={}){const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;const mod={exports:{}};const fallback=new Proxy({}, {get(){return()=>({})}});vm.runInNewContext(code,{module:mod,exports:mod.exports,process,Buffer,Date,Number,Math,JSON,Promise,Map,Set,Object,Error,BigInt,require(name){return name in mocks?mocks[name]:name.startsWith('node:')?require(name):fallback}},{filename:file});return mod.exports;}
const runtime=load('apps/server/src/domains/uploads/upload-session-runtime.ts',{
 '../../core/uploads.js':{safeFileName:x=>x},'../../core/efficiency-metrics.js':{recordEfficiencyMetric:()=>{}},'./deferred-direct-upload-journal.js':{recordDeferredDirectUpload:()=>{}}
});
function session(id,status='REVIEW_REQUIRED'){return {id,ownerId:'private-owner',workspaceId:'ws',fileName:'work.bin',mode:'direct',status,
 createdAt:new Date('2026-10-20T08:00:00Z'),updatedAt:new Date('2026-10-21T08:00:00Z'),expiresAt:new Date('2026-10-20T10:00:00Z'),totalBytes:300n,receivedBytes:200n,
 storageProvider:'s3',storageTier:'temporary',storageKey:'secret/storage/key',multipartUploadId:'secret-multipart-id',checksumSha256:'c'.repeat(64)};}
const row1=session('11111111-1111-4111-8111-111111111111','FINALIZING'),row2=session('22222222-2222-4222-8222-222222222222','CLEANING'),row3=session('33333333-3333-4333-8333-333333333333','COMPLETED');
let queries=0,mutations=0;
const db={uploadSession:{findFirst:async({where})=>[row1,row2].find(r=>r.id===where.id)||null,findMany:async({where,cursor,skip=0,take=25})=>{queries++;let rows=[row1,row2].filter(r=>where.status.in.includes(r.status));if(cursor){const idx=rows.findIndex(r=>r.id===cursor.id);rows=rows.slice(idx+skip);}return rows.slice(0,take)},count:async()=>2,delete:()=>{mutations++;throw Error('unsafe')} }};
const deps={prisma:db,storageRuntime:{directUploadTarget:()=>({provider:'s3'})},dataLayout:{runtimeRoot:'/tmp/nonreal',root:'/tmp/nonreal'}};
await test('recovery queue lists only unresolved, status-specific sessions',async()=>{const result=await runtime.uploadRecoveryQueue(deps);assert.equal(result.total,2);assert.equal(result.sessions.length,2);assert.equal(result.sessions[0].state,'FINALIZING');assert.equal(result.sessions[1].state,'CLEANING');assert.equal(result.readOnly,true);});
await test('provider keys and multipart IDs are redacted, presence indicators retained',async()=>{const result=await runtime.uploadRecoveryQueue(deps);assert.equal(result.sessions[0].hasMultipartIdentity,true);assert.equal(result.sessions[0].hasStorageLocator,true);assert.equal(result.sessions[0].dispositionAuthorized,false);const json=JSON.stringify(result);assert.ok(!json.includes('secret/storage/key'));assert.ok(!json.includes('secret-multipart-id'));});
await test('pagination is bounded and cannot cross a missing cursor',async()=>{const page=await runtime.uploadRecoveryQueue(deps,{limit:1});assert.equal(page.sessions.length,1);assert.equal(page.nextCursor,row1.id);const next=await runtime.uploadRecoveryQueue(deps,{limit:1,cursor:page.nextCursor});assert.equal(next.sessions[0].id,row2.id);await assert.rejects(runtime.uploadRecoveryQueue(deps,{cursor:'nonexistent'}),e=>e.code==='UPLOAD_RECOVERY_CURSOR_INVALID');});
await test('read-only projection does not alter provider or upload state',async()=>{await runtime.uploadRecoveryQueue(deps);assert.equal(mutations,0);assert.equal(row1.status,'FINALIZING');});
const part=new Proxy({}, {get(_target,k){if(k==='parse')return v=>({...v,limit:Number(v?.limit||25)});return (...args)=>part}});
const z={object:()=>part,coerce:{number:()=>part},string:()=>part,enum:()=>part};
const routes=load('apps/server/src/domains/library/library-9e2-routes.ts',{'zod':{z},'../uploads/upload-session-runtime.js':{uploadRecoveryQueue:runtime.uploadRecoveryQueue,uploadPressureSnapshot:async()=>({}),uploadStagingTopology:()=>({})}});
function fixture(admin){const handlers=new Map();const app={get:(path,fn)=>handlers.set('GET '+path,fn),post:(path,fn)=>handlers.set('POST '+path,fn),put:()=>{},delete:()=>{},patch:()=>{}};
 routes.registerLibrary9E2Routes({app,prisma:db,operationRuntime:{},collaborationRuntime:{},libraryAccess:{},dataLayout:deps.dataLayout,storageRuntime:deps.storageRuntime,
 getCurrentUser:async()=>({id:'operator'}),decorateUserForClient:async()=>({isAdmin:admin,workspaceRole:'member'}),hasToolPermission:()=>true,logActivity:async()=>{}});
 return async function call(query={}){const handler=handlers.get('GET /api/library/transfers/recovery');assert.ok(handler);const reply={status:200,headers:{},body:null,code(n){this.status=n;return this},header(k,v){this.headers[k]=v;return this},send(b){this.body=b;return this}};const result=await handler({query},reply);return {status:reply.status,value:reply.body??result,headers:reply.headers}};}
await test('ordinary Library users cannot inspect other users recovery state',async()=>{const call=fixture(false);const r=await call();assert.equal(r.status,403);assert.equal(r.value.code,'ADMIN_REQUIRED');});
await test('admins can inspect bounded evidence with no-store privacy headers',async()=>{const call=fixture(true);const r=await call({limit:1});assert.equal(r.status,200);assert.equal(r.value.sessions.length,1);assert.equal(r.headers['Cache-Control'],'private, no-store');});
await test('invalid cursor returns bounded 400 and no data leakage',async()=>{const call=fixture(true);const r=await call({cursor:'nonexistent'});assert.equal(r.status,400);assert.equal(r.value.code,'UPLOAD_RECOVERY_CURSOR_INVALID');});
await test('admin UI has no mutation / force-unlock affordance',()=>{const ui=readFileSync('packages/renderer/src/features/library/LibraryUploadRecoveryPanel.tsx','utf8');assert.match(ui,/read-only/i);assert.match(ui,/\/api\/library\/transfers\/recovery/);assert.ok(!ui.includes('method: "POST"'));assert.ok(!ui.includes('method: "DELETE"'));});
console.log(`G26 WS6 operator recovery: ${passed}/${passed} passed`);
