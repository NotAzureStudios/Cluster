#!/usr/bin/env node
/** G26 WS9. Controlled dependency tests of additive governance and API/UI fencing. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript/lib/typescript.js`)}})();
const dummy=new Proxy({}, { get(_t,key){if(key==='then')return undefined;return ()=>dummy;} });
const z=new Proxy({}, { get(){return ()=>dummy;} });
const src='apps/server/src/domains/library/library-bulk-governance.ts';
const transpiled=ts.transpileModule(readFileSync(src,'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const mod={exports:{}};
vm.runInNewContext(transpiled,{module:mod,exports:mod.exports,Date,Math,JSON,Number,String,Boolean,Map,Set,Object,Error,Promise,process,Buffer,require(id){if(id==='zod')return {z};if(id==='./library-platform-9e2.js')return {libraryLockIsActive:lock=>lock.state==='active'};if(id.startsWith('node:'))return require(id);throw new Error(id)}},{filename:src});
const inspect=mod.exports.inspectLibraryBulkGovernance;
const ids=['a','b'];
function row(id,props={}) {return {id,title:`File ${id}`,revision:3,type:'file',status:'active',lifecycleState:'active',legalHold:false,retentionUntil:null,...props};}
function fixture(overrides={}) {
 let records=[row('a'),row('b')], reads=0, writes=0;
 const relations={backlinks:[{itemId:'a',_count:{_all:2}}],versions:[{itemId:'b',_count:{_all:3}}],derivatives:[],personnel:[],children:[],packetDefs:[],locks:[],hierarchy:[],dispositions:[],...overrides};
 const tx={
 libraryItem:{findMany:async()=>{reads++;return records;},groupBy:async()=>relations.children,updateMany:async()=>{writes++;return {count:1}}},
 libraryBacklink:{groupBy:async()=>relations.backlinks},libraryVersion:{groupBy:async()=>relations.versions},
 libraryDerivative:{groupBy:async()=>relations.derivatives},personnelRecordAttachment:{groupBy:async()=>relations.personnel},
 packetDefinition:{findMany:async()=>relations.packetDefs},libraryAssetLock:{findMany:async()=>relations.locks},
 libraryHierarchyLifecycleEntry:{findMany:async()=>relations.hierarchy},libraryDispositionRequest:{findMany:async()=>relations.dispositions},
 };
 const command={ids,expectedRevisions:{a:3,b:3},action:'place-hold'};
 const run=(custom={})=>inspect({tx,command:{...command,...custom},canManage:()=>true,itemInclude:{}});
 return {run,tx,relations,setRows:r=>records=r,metrics:()=>({reads,writes})};
}
let passes=0;
async function test(name,fn){await fn();passes++;console.log(`PASS WS9 ${name}`)}
await test('two eligible records are additive and links are summarized',async()=>{const f=fixture();const p=await f.run();assert.equal(p.changeCount,2);assert.equal(p.blockedCount,0);assert.equal(p.references.backlinks,2);assert.equal(p.references.versions,3);assert.equal(p.selectedCount,2);assert.equal(p.items.length,2);assert.equal(p.digest.length,64);assert.equal(f.metrics().writes,0)});
await test('hold already in force is not repeated',async()=>{const f=fixture();f.setRows([row('a',{legalHold:true}),row('b')]);const p=await f.run();assert.equal(p.unchangedCount,1);assert.equal(p.changeCount,1)});
await test('deadline extension never shortens an existing longer deadline',async()=>{const f=fixture();f.setRows([row('a',{retentionUntil:'2030-01-01T00:00:00.000Z'}),row('b',{retentionUntil:'2027-01-01T00:00:00.000Z'})]);const p=await f.run({action:'extend-retention',retentionUntil:'2028-01-01T00:00:00.000Z'});assert.equal(p.changeCount,1);assert.equal(p.unchangedCount,1);assert.equal(p.retentionUntil,'2028-01-01T00:00:00.000Z')});
await test('all direct children and Packet folder references block folder propagation',async()=>{const f=fixture({children:[{parentId:'a',_count:{_all:100}}],packetDefs:[{libraryFolderId:'b'}]});const p=await f.run();assert.equal(p.blockedCount,2);assert.equal(p.references.childItems,100);assert.equal(p.references.packetDefinitions,1)});
await test('explicit folder type is blocked even when empty',async()=>{const f=fixture();f.setRows([row('a',{type:'folder'}),row('b')]);assert.equal((await f.run()).blockedCount,1)});
await test('Personnel attachment blocks aggregate changes',async()=>{const f=fixture({personnel:[{libraryItemId:'a',_count:{_all:1}}]});assert.equal((await f.run()).items[0].outcome,'blocked')});
await test('active locks block and expired locks do not',async()=>{const f=fixture({locks:[{itemId:'a',state:'active'},{itemId:'b',state:'expired'}]});const p=await f.run();assert.equal(p.blockedCount,1);assert.equal(p.items[1].outcome,'change')});
await test('unresolved disposition blocks strengthening until review',async()=>{const f=fixture({dispositions:[{itemId:'b'}]});assert.equal((await f.run()).blockedCount,1)});
await test('in-progress hierarchy operations block independent edits',async()=>{const f=fixture({hierarchy:[{itemId:'a'}]});assert.equal((await f.run()).blockedCount,1)});
await test('trashed or destroyed records do not enter additive workflow',async()=>{const f=fixture();f.setRows([row('a',{status:'trashed'}),row('b',{lifecycleState:'destroyed'})]);assert.equal((await f.run()).blockedCount,2)});
await test('missing identity denies whole preview rather than leaking partial names',async()=>{const f=fixture();f.setRows([row('a')]);await assert.rejects(f.run(),/unavailable or not authorized/)});
await test('loss of per-item manage authorization denies whole preview',async()=>{const f=fixture();await assert.rejects(inspect({tx:f.tx,command:{ids,expectedRevisions:{},action:'place-hold'},canManage:x=>x.id==='a',itemInclude:{}}),/not authorized/)});
await test('preview digest changes on row revision and existing retention',async()=>{const f=fixture();const one=(await f.run()).digest;f.setRows([row('a',{revision:4}),row('b')]);const two=(await f.run()).digest;assert.notEqual(one,two);f.setRows([row('a',{revision:4,legalHold:true}),row('b')]);assert.notEqual(two,(await f.run()).digest)});
await test('preview digest changes on known relationship count',async()=>{const f=fixture();const before=(await f.run()).digest;f.relations.backlinks=[{itemId:'a',_count:{_all:3}}];assert.notEqual(before,(await f.run()).digest)});
await test('selection order does not alter hashed evidence',async()=>{const f=fixture();const one=(await f.run()).digest;assert.equal(one,(await f.run({ids:['b','a']})).digest)});
await test('read-only inspection has no DB writes',async()=>{const f=fixture();await f.run();assert.equal(f.metrics().writes,0)});
const routes=readFileSync('apps/server/src/domains/library/library-routes.ts','utf8');
const ui=readFileSync('packages/renderer/src/features/library/LibraryGovernanceBulkModal.tsx','utf8');
const page=readFileSync('packages/renderer/src/features/library/LibraryWorkspacePage.tsx','utf8');
await test('distinct preview and apply routes exist and require admin authority',async()=>{assert.match(routes,/app\.post\("\/api\/library\/bulk\/governance\/preview"/);assert.match(routes,/app\.post\("\/api\/library\/bulk\/governance\/apply"/);assert.match(routes,/context\.decorated\?\.isAdmin/);assert.match(routes,/caller\.decorated\?\.isAdmin/)});
await test('transactional apply is CAS + Serializable with atomic evidence',async()=>{const fragment=routes.split('app.post("/api/library/bulk/governance/apply"')[1].split('app.post("/api/library/bulk/preview"')[0];assert.match(fragment,/prisma\.\$transaction/);assert.match(fragment,/isolationLevel: "Serializable"/);assert.match(fragment,/preview\.digest !== command\.digest/);assert.match(fragment,/preview\.blockedCount/);assert.match(fragment,/commitLibraryGovernanceStrengthening/);assert.match(readFileSync(src,'utf8'),/updateMany/);assert.match(readFileSync(src,'utf8'),/revision: entry\.revision/);assert.match(fragment,/tx\.activityEvent\.create/);assert.doesNotMatch(fragment,/\.delete\(/)});
await test('bulk UI requires full selected revisions and holds stale preview off',async()=>{assert.match(page,/isSelectionCurrent=\{/);assert.match(page,/governanceQueryRef\.current === queryKey/);assert.match(ui,/setPreview\(null\)/);assert.match(ui,/preview\.blockedCount > 0/);assert.match(ui,/reason\.trim\(\)\.length < 12/)});
await test('no-go zone: destructive mutation and weakened bulk holds are not exposed',async()=>{assert.doesNotMatch(ui,/"remove-hold"|"shorten-retention"|"delete-files"/);assert.match(ui,/cannot lift holds, shorten retention/);assert.match(routes,/GOVERNANCE_PREVIEW_STALE/)});
console.log(`PASS WS9 ${passes}/${passes} governance checks`);
