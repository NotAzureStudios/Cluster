#!/usr/bin/env node
/** G26 Batch C: real bounded subtree walker + production inspection logic. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript/lib/typescript.js`)}})();
const zShape={min(){return this},max(){return this},int(){return this},positive(){return this},trim(){return this},optional(){return this},nullable(){return this},regex(){return this},refine(){return this},superRefine(){return this},parse(value){return value}};
const z={object:()=>zShape,array:()=>zShape,string:()=>zShape,number:()=>zShape,enum:()=>zShape,record:()=>zShape};
function load(file,deps={}) {
 const source=readFileSync(file,'utf8');const mod={exports:{}};
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 vm.runInNewContext(js,{module:mod,exports:mod.exports,require(name){if(name==='zod')return {z};if(name in deps)return deps[name];return require(name)},Date,Math,JSON,Number,String,Boolean,Map,Set,Object,Error,Promise,Buffer,Array,process,console},{filename:file});
 return mod.exports;
}
const scope=load('apps/server/src/domains/library/library-bulk-scope.ts');
const guards={LibraryBulkGuardError:class LibraryBulkGuardError extends Error{constructor(code,message,status=409){super(message);this.code=code;this.status=status}}};
const flat=load('apps/server/src/domains/library/library-bulk-governance.ts',{'./library-platform-9e2.js':{libraryLockIsActive:row=>row.state==='active'}});
const hierarchy=load('apps/server/src/domains/library/library-hierarchy-governance.ts',{
 './library-bulk-scope.js':scope,'./library-bulk-transaction-guard.js':guards,'./library-bulk-governance.js':flat,
});
function item(id,parentId=null,extra={}){return {id,parentId,title:`Item ${id}`,projectId:'project',revision:3,type:parentId?'file':'folder',source:'manual',status:'active',lifecycleState:'active',legalHold:false,retentionUntil:null,...extra}};
function fixture(initial=[item('root'),item('a','root'),item('b','root')]){
 let rows=initial,active=true,admin=true,denied=new Set(),writes=[],mutationFault=false;
 const lookup=(ids)=>rows.filter(row=>ids.includes(row.id));
 const empty={groupBy:async()=>[],findMany:async()=>[]};
 const tx={
  user:{findUnique:async()=>active?{id:'operator',archived:false,accountState:'ACTIVE',accessExpiresAt:null}:null},
  libraryItem:{findMany:async(query)=>query.where?.id?.in?lookup(query.where.id.in):
     rows.filter(row=>query.where?.parentId?.in?.includes(row.parentId)).slice(0,query.take),
     groupBy:async(query)=>rows.filter(row=>query.where.parentId.in.includes(row.parentId)).reduce((result,row)=>{
       const found=result.find(x=>x.parentId===row.parentId);if(found)found._count._all++;else result.push({parentId:row.parentId,_count:{_all:1}});return result;
     },[]),updateMany:async(command)=>{writes.push(command);return {count:mutationFault?0:1}}},
  libraryBacklink:{groupBy:async()=>[]},libraryVersion:{groupBy:async()=>[]},libraryDerivative:{groupBy:async()=>[]},
  personnelRecordAttachment:{groupBy:async()=>[]},packetDefinition:empty,
  libraryAssetLock:empty,libraryHierarchyLifecycleEntry:empty,libraryDispositionRequest:empty,
 };
 const access={contextForUser:async()=>({decorated:{isAdmin:admin}}),visibleFor:(_ctx,row)=>!denied.has(row.id)};
 const command={roots:[{id:'root',revision:3}],action:'place-hold'};
 const inspect=(changes={})=>hierarchy.inspectLibraryHierarchyGovernance({tx,actorId:'operator',command:{...command,...changes},access,itemInclude:{}});
 return {tx,access,inspect,replace:value=>rows=value,changeActive:value=>active=value,changeAdmin:value=>admin=value,deny:id=>denied.add(id),writes,failCAS:()=>mutationFault=true};
}
let checks=0;
async function check(label,fn){await fn();checks++;console.log(`PASS G26 Batch C hierarchy ${label}`)}
const failure=async(fn,code)=>{await assert.rejects(fn(),error=>error.code===code,code)};
await check('complete tree preview includes root and every descendant',async()=>{const f=fixture();const p=await f.inspect();assert.equal(p.selectedCount,3);assert.equal(p.rootCount,1);assert.equal(p.scope,'hierarchy');assert.equal(p.changeCount,3);assert.equal(p.blockedCount,0);assert.equal(f.writes.length,0)});
await check('nested folders are traversed not merely immediate children',async()=>{const f=fixture([item('root'),item('f','root',{type:'folder'}),item('x','f')]);const p=await f.inspect();assert.equal(p.selectedCount,3);assert.equal(p.references.childItems,2)});
await check('a protected leaf already on legal hold remains unchanged',async()=>{const f=fixture([item('root'),item('x','root',{legalHold:true})]);const p=await f.inspect();assert.equal(p.unchangedCount,1);assert.equal(p.changeCount,1)});
await check('a longer retention deadline is never shortened',async()=>{const f=fixture([item('root'),item('x','root',{retentionUntil:'2040-01-01T00:00:00Z'})]);const p=await f.inspect({action:'extend-retention',retentionUntil:'2035-01-01T00:00:00Z'});assert.equal(p.changeCount,1);assert.equal(p.unchangedCount,1)});
await check('a trashed descendant blocks the overall operation',async()=>{const f=fixture([item('root'),item('x','root',{status:'trashed'})]);assert.equal((await f.inspect()).blockedCount,1)});
await check('lost descendant ACL denies full preview without enumerating restricted titles',async()=>{const f=fixture();f.deny('a');await failure(()=>f.inspect(),'LIBRARY_GOVERNANCE_TREE_ACCESS')});
await check('admin authority is required inside transaction',async()=>{const f=fixture();f.changeAdmin(false);await failure(()=>f.inspect(),'LIBRARY_GOVERNANCE_ACCESS')});
await check('inactive actor cannot commit a previously authorized preview',async()=>{const f=fixture();await f.inspect();f.changeActive(false);await failure(()=>f.inspect(),'LIBRARY_GOVERNANCE_ACCESS')});
await check('stale root revision blocks preview',async()=>{const f=fixture();await failure(()=>f.inspect({roots:[{id:'root',revision:2}]}),'LIBRARY_GOVERNANCE_TREE_ACCESS')});
await check('managed project folder cannot be a selected root',async()=>{const f=fixture([item('root',null,{source:'project-folder'})]);await failure(()=>f.inspect(),'LIBRARY_GOVERNANCE_TREE_ACCESS')});
await check('managed Packet folder descendant blocks entire tree',async()=>{const f=fixture([item('root'),item('x','root',{type:'folder',source:'packets-root'})]);await failure(()=>f.inspect(),'LIBRARY_GOVERNANCE_TREE_ACCESS')});
await check('cross Project boundary blocks tree mutation',async()=>{const f=fixture([item('root'),item('x','root',{projectId:'different'})]);await failure(()=>f.inspect(),'LIBRARY_GOVERNANCE_PROJECT_BOUNDARY')});
await check('missing root denies tree review',async()=>{const f=fixture([]);await failure(()=>f.inspect(),'LIBRARY_GOVERNANCE_TREE_ACCESS')});
await check('nonfolder root denies hierarchy operation',async()=>{const f=fixture([item('root',null,{type:'file'})]);await failure(()=>f.inspect(),'LIBRARY_GOVERNANCE_TREE_ACCESS')});
await check('overlapping roots rejected even when descendant deduplicated',async()=>{const f=fixture([item('root'),item('inner','root',{type:'folder'}),item('x','inner')]);await failure(()=>f.inspect({roots:[{id:'root',revision:3},{id:'inner',revision:3}]}),'LIBRARY_GOVERNANCE_TREE_OVERLAP')});
await check('bounded walk rejects more than 160 objects',async()=>{const children=Array.from({length:160},(_,index)=>item(`x${index}`,'root'));const f=fixture([item('root'),...children]);await failure(()=>f.inspect(),'LIBRARY_GOVERNANCE_TREE_LIMIT')});
await check('digest changes when descendant added',async()=>{const f=fixture();const a=(await f.inspect()).digest;f.replace([item('root'),item('a','root'),item('b','root'),item('c','root')]);assert.notEqual(a,(await f.inspect()).digest)});
await check('digest changes when descendant moved out of tree',async()=>{const f=fixture();const a=(await f.inspect()).digest;f.replace([item('root'),item('a',null,{type:'file'}),item('b','root')]);assert.notEqual(a,(await f.inspect()).digest)});
await check('digest changes when parent topology changes without revision change',async()=>{const f=fixture([item('root'),item('f','root',{type:'folder'}),item('x','f')]);const a=(await f.inspect()).digest;f.replace([item('root'),item('f','root',{type:'folder'}),item('x','root')]);assert.notEqual(a,(await f.inspect()).digest)});
await check('digest changes when child hold changes',async()=>{const f=fixture();const a=(await f.inspect()).digest;f.replace([item('root'),item('a','root',{legalHold:true}),item('b','root')]);assert.notEqual(a,(await f.inspect()).digest)});
await check('shared CAS helper applies all changed items with revisions',async()=>{const f=fixture();const p=await f.inspect();await flat.commitLibraryGovernanceStrengthening(f.tx,p,'operator');assert.equal(f.writes.length,3);assert.equal(f.writes[0].where.revision,3);assert.equal(f.writes[0].data.legalHold,true)});
await check('shared CAS helper fails closed on concurrent item change',async()=>{const f=fixture();const p=await f.inspect();f.failCAS();await failure(()=>flat.commitLibraryGovernanceStrengthening(f.tx,p,'operator'),'GOVERNANCE_REVISION_CONFLICT')});
const routes=readFileSync('apps/server/src/domains/library/library-routes.ts','utf8');
const ui=readFileSync('packages/renderer/src/features/library/LibraryGovernanceBulkModal.tsx','utf8');
await check('two distinct admin-only hierarchy routes are provided',async()=>{assert.match(routes,/app\.post\("\/api\/library\/bulk\/governance\/hierarchy\/preview"/);assert.match(routes,/app\.post\("\/api\/library\/bulk\/governance\/hierarchy\/apply"/);assert.match(routes,/caller\.decorated\?\.isAdmin/)});
await check('preview happens inside repeatable-read and apply inside serializable',async()=>{const section=routes.split('// G26 Batch C: bounded subtree-wide strengthening')[1].split('app.post("/api/library/bulk/preview"')[0];assert.match(section,/isolationLevel: "RepeatableRead"/);assert.match(section,/isolationLevel: "Serializable"/);assert.match(section,/preview\.digest !== command\.digest/);assert.match(section,/commitLibraryGovernanceStrengthening/);assert.match(section,/tx\.activityEvent\.create/);assert.doesNotMatch(section,/\.delete\(/)});
await check('UI binds to both explicit scopes and protects stale selection',async()=>{assert.match(ui,/scope === "hierarchy"/);assert.match(ui,/hierarchyEligible/);assert.match(ui,/isSelectionCurrent\(\)/);assert.match(ui,/setPreview\(null\)/);assert.match(ui,/preview\.blockedCount/)});
await check('no automatic physical disposal or hold removal added',async()=>{const server=readFileSync('apps/server/src/domains/library/library-hierarchy-governance.ts','utf8');assert.doesNotMatch(server,/deleteMany|unlink\(|remove-hold|shorten-retention|storageRuntime\.delete/)});
console.log(`Cluster G26 Batch C hierarchy: ${checks}/${checks} checks passed`);
