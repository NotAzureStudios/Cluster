/** R61 actual TypeScript module execution with in-memory transactional Prisma fixture.
 * No live Postgres is claimed; the fixture verifies snapshot, CAS, checkpoint,
 * failure atomicity, queue record and ACL semantics of the real handlers.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const libraries = new Map();
function schema(){ const x = {parse:v=>v, min:()=>x,max:()=>x,int:()=>x,positive:()=>x,regex:()=>x,uuid:()=>x,nullable:()=>x,optional:()=>x,superRefine:()=>x,extend:()=>x};return x;}
const z = {object:schema,array:schema,string:schema,number:schema};
function load(file){
 if(libraries.has(file)) return libraries.get(file);
 const code=fs.readFileSync(file,'utf8');
 const transpiled=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal(transpiled.diagnostics?.length||0,0,`TS parse ${file}`);
 const mod={exports:{}};
 const dep={
  'zod':{z},
  './library-platform-9e2.js':{libraryLockIsActive:row=>Boolean(row && row.active)},
 };
 const requireSource=id=>{
  if(id in dep)return dep[id];
  if(id.startsWith('node:'))return require(id);
  if(id.startsWith('./')){
   const dest=path.posix.normalize(path.posix.join(path.posix.dirname(file),id.replace(/\.js$/,'.ts')));
   return load(dest);
  }
  throw Error('unknown imported dependency '+id+' in '+file);
 };
 vm.runInNewContext(transpiled.outputText,{module:mod,exports:mod.exports,require:requireSource,Buffer,Date,JSON,String,Number,Boolean,Math,Set,Map,Error,Promise,console,process}, {filename:file});
 libraries.set(file,mod.exports);return mod.exports;
}
const lib=load('apps/server/src/domains/library/library-hierarchy-move.ts');
const {inspectLibraryHierarchyMove,registerLibraryHierarchyMoveJob,libraryHierarchyFingerprint}=lib;
const {LibraryBulkGuardError}=load('apps/server/src/domains/library/library-bulk-transaction-guard.ts');
const clone=x=>structuredClone(x);
function fixture(){
 const items=new Map([
  ['a',{id:'a',parentId:null,projectId:'p',type:'folder',title:'A',revision:1,status:'active',lifecycleState:'active'}],
  ['b',{id:'b',parentId:null,projectId:'p',type:'folder',title:'B',revision:1,status:'active',lifecycleState:'active'}],
  ['a1',{id:'a1',parentId:'a',projectId:'p',type:'note',title:'File A',revision:1,status:'active',lifecycleState:'active'}],
  ['b1',{id:'b1',parentId:'b',projectId:'p',type:'note',title:'File B',revision:1,status:'active',lifecycleState:'active'}],
  ['dest',{id:'dest',parentId:null,projectId:'p',type:'folder',title:'Destination',revision:1,status:'active',lifecycleState:'active'}],
 ]);
 const f={state:{items,checkpoints:new Map(),activity:[],jobs:[],actor:{id:'u',archived:false,accountState:'ACTIVE'},denied:new Set(),locks:new Set(),protected:new Set(),failRepair:false}};
 const access={
  contextForUser:async user=>({user}),
  visibleFor:(_ctx,item)=> !f.state.denied.has(item.id),
 };
 const buildTx=(state)=>{
  const query=(filter={})=>[...state.items.values()].filter(r=>{
   if(filter.id?.in && !filter.id.in.includes(r.id))return false;
   if(filter.parentId?.in && !filter.parentId.in.includes(r.parentId))return false;
   return true;
  }).map(clone);
  return {
   user:{findUnique:async()=>clone(state.actor)},
   libraryItem:{
    findUnique:async({where})=>clone(state.items.get(where.id)||null),
    findMany:async({where={},take})=>query(where).slice(0,take||50000),
    updateMany:async({where,data})=>{
     const row=state.items.get(where.id);
     if(!row || row.revision!==where.revision || (where.parentId!==undefined && row.parentId!==where.parentId))return{count:0};
     Object.assign(row,Object.fromEntries(Object.entries(data).filter(([k])=>k!=='revision')));
     row.revision+=data.revision.increment;
     return {count:1};
    }
   },
   libraryAssetLock:{findMany:async({where})=>[...state.locks].filter(id=>where.itemId.in.includes(id)).map(itemId=>({itemId,active:true}))},
   personnelRecordAttachment:{findMany:async({where})=>[...state.protected].filter(id=>where.libraryItemId.in.includes(id)).map(libraryItemId=>({libraryItemId}))},
   libraryBulkCheckpoint:{
    upsert:async({where})=>{if(!state.checkpoints.has(where.jobId))state.checkpoints.set(where.jobId,{nextIndex:0,changed:0,skipped:0})},
    findUniqueOrThrow:async({where})=>clone(state.checkpoints.get(where.jobId)),
    updateMany:async({where,data})=>{
     const row=state.checkpoints.get(where.jobId);
     if(row.nextIndex!==where.nextIndex)return{count:0};
     row.nextIndex=data.nextIndex;
     row.changed+=(data.changed?.increment||0);row.skipped+=(data.skipped?.increment||0);
     return{count:1};
    },
   },
   backgroundJob:{create:async({data})=>{if(state.failRepair)throw Error('reconciliation queue storage failure');state.jobs.push(clone(data));return data;}},
   activityEvent:{create:async({data})=>{state.activity.push(clone(data));return data;}},
  };
 };
 f.prisma={
  $transaction:async(callback)=>{
   const copy=clone(f.state);
   const result=await callback(buildTx(copy));
   f.state=copy;
   return result;
  },
  libraryBulkCheckpoint:{
   upsert:async(q)=>buildTx(f.state).libraryBulkCheckpoint.upsert(q),
   findUniqueOrThrow:async(q)=>buildTx(f.state).libraryBulkCheckpoint.findUniqueOrThrow(q),
  },
 };
 f.access=access;
 f.snapshot=(roots=[{id:'a',revision:1},{id:'b',revision:1}],parentId='dest')=>f.prisma.$transaction(tx=>inspectLibraryHierarchyMove({tx,actorId:'u',roots,parentId,access}));
 f.handler=(()=>{let handler;registerLibraryHierarchyMoveJob({worker:{register:(type,fn)=>{assert.equal(type,'library.hierarchy.move');handler=fn}},prisma:f.prisma,access});return handler})();
 f.run=async(selection, options={})=>f.handler({
  job:{id:'hier-job-1',createdById:'u'},
  payload:{actorId:'u',parentId:'dest',destinationFingerprint:selection.destinationFingerprint,targets:selection.targets},
  throwIfCancelled:async()=>{if(options.cancel?.())throw Error('cancelled')},
  throwIfToolUnavailable:async()=>{if(options.disabled?.())throw Error('disabled')},
  updateProgress:async()=>options.updateProgress?.(),
 });
 return f;
}
let checks=0;
async function check(name,fn){await fn();console.log('PASS',name);checks++}
await check('authorized snapshot covers both subtrees and canonical stable digest',async()=>{
 const f=fixture(),v=await f.snapshot();assert.equal(v.affected,4);assert.equal(v.targets.length,2);assert.match(v.digest,/^[0-9a-f]{64}$/);assert.equal((await f.snapshot()).digest,v.digest);
});
await check('changing any descendant revision invalidates the selected hierarchy',async()=>{
 const f=fixture(),v=await f.snapshot();f.state.items.get('a1').revision++;
 assert.notEqual((await f.snapshot()).digest,v.digest);
 await assert.rejects(()=>f.run(v),/changed since preview/);
 assert.equal(f.state.items.get('a').revision,1);
});
await check('destination chain revisions and parent changes invalidate the preview',async()=>{
 const f=fixture(),v=await f.snapshot();f.state.items.get('dest').revision++;
 await assert.rejects(()=>f.run(v),/changed since preview/);
 assert.equal(f.state.items.get('a').parentId,null);
});
await check('overlapping selected folder roots are refused',async()=>{
 const f=fixture();f.state.items.set('nested',{id:'nested',parentId:'a',projectId:'p',type:'folder',revision:1,status:'active',lifecycleState:'active'});
 await assert.rejects(()=>f.snapshot([{id:'a',revision:1},{id:'nested',revision:1}]),/overlap/);
});
await check('nested ACL revocation blocks the move',async()=>{
 const f=fixture(),v=await f.snapshot();f.state.denied.add('a1');
 await assert.rejects(()=>f.run(v),/inaccessible/);assert.equal(f.state.items.get('a').parentId,null);
});
await check('protected attachments and active locks forbid changes',async()=>{
 const f=fixture();f.state.protected.add('b1');await assert.rejects(()=>f.snapshot(),/Personnel Records/);
 f.state.protected.clear();f.state.locks.add('a1');await assert.rejects(()=>f.snapshot(),/edit lock/);
});
await check('managed Project folders cannot be moved through a hierarchy job',async()=>{
 const f=fixture();f.state.items.get('a').source='project-folder';await assert.rejects(()=>f.snapshot(),/managed/);
});
await check('Project cross-boundary moves refuse even hidden nested child drift',async()=>{
 const f=fixture();f.state.items.get('a1').projectId='other';await assert.rejects(()=>f.snapshot(),/Project ownership/);
});
await check('moving a root into itself or a descendant is blocked',async()=>{
 const f=fixture();await assert.rejects(()=>f.snapshot([{id:'a',revision:1}],'a'),/cannot be moved into itself/);
});
await check('completed root and repair record survive lost progress acknowledgment exactly once',async()=>{
 const f=fixture(),v=await f.snapshot();let progress=0;
 await assert.rejects(()=>f.run(v,{updateProgress:()=>{if(++progress===1)throw Error('ack lost')}}),/ack lost/);
 assert.equal(f.state.items.get('a').parentId,'dest');assert.equal(f.state.items.get('b').parentId,null);
 assert.equal(f.state.checkpoints.get('hier-job-1').nextIndex,1);assert.equal(f.state.jobs.length,1);
 const done=await f.run(v);assert.equal(done.moved,2);assert.equal(done.reconciliationJobs,2);
 assert.equal(f.state.jobs.length,2);assert.equal(f.state.activity.length,2);
 assert.equal(f.state.items.get('a').revision,2);assert.equal(f.state.items.get('a1').revision,1);
});
await check('reconciliation queue database failure rolls back the root move and checkpoint',async()=>{
 const f=fixture(),v=await f.snapshot();f.state.failRepair=true;
 await assert.rejects(()=>f.run(v),/reconciliation queue storage failure/);
 assert.equal(f.state.items.get('a').revision,1);assert.equal(f.state.items.get('a').parentId,null);
 assert.equal(f.state.checkpoints.get('hier-job-1').nextIndex,0);assert.equal(f.state.jobs.length,0);
 f.state.failRepair=false;assert.equal((await f.run(v)).moved,2);
});
await check('offboarding actor after one committed root refuses remaining writes',async()=>{
 const f=fixture(),v=await f.snapshot();let events=0;
 await assert.rejects(()=>f.run(v,{updateProgress:()=>{if(++events===1)f.state.actor.archived=true}}),/initiating account is no longer active/);
 assert.equal(f.state.items.get('a').parentId,'dest');assert.equal(f.state.items.get('b').parentId,null);
 assert.equal(f.state.jobs.length,1);
});
await check('cancel before a root transaction changes nothing',async()=>{
 const f=fixture(),v=await f.snapshot();await assert.rejects(()=>f.run(v,{cancel:()=>true}),/cancelled/);
 assert.equal(f.state.items.get('a').parentId,null);assert.equal(f.state.jobs.length,0);
});
await check('preview limit refuses a hierarchy over 5000 entries',async()=>{
 const f=fixture();for(let i=0;i<5002;i++)f.state.items.set('child'+i,{id:'child'+i,parentId:'a',projectId:'p',type:'note',revision:1,status:'active',lifecycleState:'active'});
 await assert.rejects(()=>f.snapshot(),/too large|more than 5,000/);
});
await check('same-parent move records skip without scheduling storage repair',async()=>{
 const f=fixture(),v=await f.snapshot([{id:'a',revision:1}],null);
 const result=await f.handler({
  job:{id:'hier-job-1',createdById:'u'},
  payload:{actorId:'u',parentId:null,destinationFingerprint:v.destinationFingerprint,targets:v.targets},
  throwIfCancelled:async()=>{},throwIfToolUnavailable:async()=>{},updateProgress:async()=>{},
 });
 assert.equal(result.moved,0);assert.equal(result.skipped,1);
 assert.equal(f.state.jobs.length,0);assert.equal(f.state.activity.length,1);
});
assert.ok(LibraryBulkGuardError);
console.log(`R61 hierarchy move: ${checks}/${checks} focused checks passed`);
