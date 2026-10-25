/** Execute actual TS handlers in a transactionally isolated in-memory Prisma
 * adapter. Does not represent live PostgreSQL or binary storage certification. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const cache=new Map();
function zSchema(){const x={parse:v=>v,min:()=>x,max:()=>x,int:()=>x,positive:()=>x,nonnegative:()=>x,regex:()=>x,uuid:()=>x,nullable:()=>x,optional:()=>x,superRefine:()=>x,extend:()=>x};return x}
const z={object:zSchema,array:zSchema,string:zSchema,number:zSchema,enum:zSchema};
function load(file){
 if(cache.has(file))return cache.get(file);
 const code=fs.readFileSync(file,'utf8');
 const js=ts.transpileModule(code,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal(js.diagnostics?.length||0,0,'TS parse '+file);
 const mod={exports:{}};
 const localRequire=id=>{
  if(id==='zod')return{z};
  if(id==='./library-platform-9e2.js')return{libraryLockIsActive:lock=>Boolean(lock?.active)};
  if(id.startsWith('node:'))return require(id);
  if(id.startsWith('./'))return load(path.posix.normalize(path.posix.join(path.posix.dirname(file),id.replace(/\.js$/,'.ts'))));
  throw Error('unmocked '+id);
 };
 vm.runInNewContext(js.outputText,{require:localRequire,module:mod,exports:mod.exports,Buffer,Date,JSON,String,Number,Boolean,Math,Set,Map,Error,Promise,console,process},{filename:file});
 cache.set(file,mod.exports);return mod.exports;
}
const {inspectLibraryHierarchyLifecycle,registerLibraryHierarchyLifecycleJob}=load('apps/server/src/domains/library/library-hierarchy-lifecycle.ts');
const clone=x=>structuredClone(x);
function fixture(){
 const state={
  items:new Map([
   ['a',{id:'a',parentId:null,projectId:'p',type:'folder',revision:1,status:'active',lifecycleState:'active'}],
   ['a1',{id:'a1',parentId:'a',projectId:'p',type:'note',revision:1,status:'active',lifecycleState:'active'}],
   ['a2',{id:'a2',parentId:'a',projectId:'p',type:'note',revision:1,status:'trashed',lifecycleState:'trashed',deletedAt:new Date('2026-08-01'),deletedById:'u'}],
   ['b',{id:'b',parentId:null,projectId:'p',type:'folder',revision:1,status:'active',lifecycleState:'active'}],
   ['b1',{id:'b1',parentId:'b',projectId:'p',type:'note',revision:1,status:'active',lifecycleState:'active'}],
  ]),entries:[],checkpoints:new Map(),activity:[],actor:{id:'u',archived:false,accountState:'ACTIVE'},denied:new Set(),locks:new Set(),protected:new Set(),failEvidence:false,
 };
 const f={state};
 const access={contextForUser:async actor=>({user:actor}),visibleFor:(_context,item)=>!f.state.denied.has(item.id)};
 function tx(s){
  const eligible=(row,where)=>{
   if(where.id?.in&&!where.id.in.includes(row.id))return false;
   if(typeof where.id==='string' && where.id!==row.id)return false;
   if(where.parentId?.in&&!where.parentId.in.includes(row.parentId))return false;
   if(where.revision!==undefined && row.revision!==where.revision)return false;
   return true;
  };
  const entryMatch=(entry,where)=>!Object.entries(where||{}).some(([key,value])=>{
   if(value && typeof value==='object' && !Array.isArray(value) && 'in' in value)return !value.in.includes(entry[key]);
   return entry[key]!==value;
  });
  return {
   user:{findUnique:async()=>clone(s.actor)},
   libraryItem:{
    findUnique:async({where})=>clone(s.items.get(where.id)||null),
    findMany:async({where={},take})=>[...s.items.values()].filter(row=>eligible(row,where)).slice(0,take??1e6).map(clone),
    updateMany:async({where,data})=>{
     const selected=[...s.items.values()].filter(row=>eligible(row,where));
     for(const row of selected){Object.assign(row,Object.fromEntries(Object.entries(data).filter(([key])=>key!=='revision')));row.revision+=data.revision.increment;}
     return{count:selected.length};
    }
   },
   libraryAssetLock:{findMany:async({where})=>[...s.locks].filter(id=>where.itemId.in.includes(id)).map(itemId=>({itemId,active:true}))},
   personnelRecordAttachment:{findMany:async({where})=>[...s.protected].filter(id=>where.libraryItemId.in.includes(id)).map(libraryItemId=>({libraryItemId}))},
   libraryHierarchyLifecycleEntry:{
    findFirst:async({where})=>clone(s.entries.filter(e=>entryMatch(e,where)).sort((a,b)=>b.createdAt-a.createdAt)[0]||null),
    findMany:async({where})=>s.entries.filter(e=>entryMatch(e,where)).map(clone),
    createMany:async({data})=>{
     if(s.failEvidence)throw Error('evidence persistence failure');
     for(const entry of data){if(s.entries.some(e=>e.jobId===entry.jobId&&e.itemId===entry.itemId))throw Error('duplicate mark');s.entries.push({...clone(entry),restoredAt:null,createdAt:new Date()})}
     return{count:data.length};
    },
    updateMany:async({where,data})=>{
     const matches=s.entries.filter(e=>entryMatch(e,where));for(const entry of matches)Object.assign(entry,clone(data));return{count:matches.length};
    },
   },
   libraryBulkCheckpoint:{
    upsert:async({where})=>{if(!s.checkpoints.has(where.jobId))s.checkpoints.set(where.jobId,{nextIndex:0,changed:0,skipped:0})},
    findUniqueOrThrow:async({where})=>clone(s.checkpoints.get(where.jobId)),
    updateMany:async({where,data})=>{const row=s.checkpoints.get(where.jobId);if(row.nextIndex!==where.nextIndex)return{count:0};row.nextIndex=data.nextIndex;row.changed+=data.changed.increment;row.skipped+=data.skipped.increment;return{count:1}},
   },
   activityEvent:{create:async({data})=>{s.activity.push(clone(data));return data}},
  };
 }
 f.prisma={
  $transaction:async fn=>{const copy=clone(f.state);const result=await fn(tx(copy));f.state=copy;return result},
  libraryBulkCheckpoint:{upsert:async q=>tx(f.state).libraryBulkCheckpoint.upsert(q),findUniqueOrThrow:async q=>tx(f.state).libraryBulkCheckpoint.findUniqueOrThrow(q)},
 };
 f.inspect=(action,roots=[{id:'a',revision:f.state.items.get('a').revision}])=>f.prisma.$transaction(tx=>inspectLibraryHierarchyLifecycle({tx,actorId:'u',action,roots,access}));
 f.handler=(()=>{let handler;registerLibraryHierarchyLifecycleJob({worker:{register:(name,fn)=>{assert.equal(name,'library.hierarchy.lifecycle');handler=fn}},prisma:f.prisma,access});return handler})();
 f.run=(snapshot,action,jobId,options={})=>f.handler({job:{id:jobId,createdById:'u'},payload:{actorId:'u',action,targets:snapshot.targets},
  throwIfCancelled:async()=>{if(options.cancel?.())throw Error('cancelled')},throwIfToolUnavailable:async()=>{if(options.disabled?.())throw Error('disabled')},
  updateProgress:async()=>options.progress?.()});
 return f;
}
let count=0;async function check(name,fn){await fn();count++;console.log('PASS',name)}
await check('trash snapshot counts unchanged independent deletion',async()=>{const f=fixture();const v=await f.inspect('trash');assert.equal(v.affected,3);assert.equal(v.preserved,1);assert.match(v.digest,/^[a-f0-9]{64}$/)});
await check('trash preserves independently trashed child and persists marks only for changed records',async()=>{
 const f=fixture();await f.run(await f.inspect('trash'),'trash','trashjob');
 assert.equal(f.state.items.get('a').status,'trashed');assert.equal(f.state.items.get('a1').status,'trashed');assert.equal(f.state.items.get('a2').revision,1);
 assert.deepEqual(f.state.entries.map(m=>m.itemId).sort(),['a','a1']);
 assert.equal(f.state.checkpoints.get('trashjob').changed,2);
});
await check('provenance restore restores touched descendants but never independently trashed content',async()=>{
 const f=fixture();await f.run(await f.inspect('trash'),'trash','trashjob');
 const v=await f.inspect('restore');assert.equal(v.preserved,1);
 await f.run(v,'restore','restorejob');
 assert.equal(f.state.items.get('a').status,'active');assert.equal(f.state.items.get('a1').status,'active');
 assert.equal(f.state.items.get('a2').status,'trashed');assert.equal(f.state.items.get('a2').revision,1);
 assert.equal(f.state.entries.filter(e=>e.restoredAt).length,2);
 await assert.rejects(()=>f.inspect('restore'),/No active hierarchy lifecycle record/);
});
await check('archive preserves independent archived and trashed descendants; restore preserves original states',async()=>{
 const f=fixture();f.state.items.get('a1').status='archived';
 await f.run(await f.inspect('archive'),'archive','archivejob');
 assert.equal(f.state.items.get('a').status,'archived');assert.equal(f.state.items.get('a1').revision,1);
 await f.run(await f.inspect('restore'),'restore','restorejob');
 assert.equal(f.state.items.get('a').status,'active');assert.equal(f.state.items.get('a1').status,'archived');assert.equal(f.state.items.get('a2').status,'trashed');
});
await check('legal hold and retention block trash on any untouched descendant',async()=>{
 const f=fixture();f.state.items.get('a1').legalHold=true;await assert.rejects(()=>f.inspect('trash'),/legal hold or retention/);
 f.state.items.get('a1').legalHold=false;f.state.items.get('a1').retentionUntil=new Date('2099-01-01');await assert.rejects(()=>f.inspect('trash'),/legal hold or retention/);
});
await check('nested ACL, Personnel Record and locks block preview',async()=>{
 const f=fixture();f.state.denied.add('a1');await assert.rejects(()=>f.inspect('trash'),/protected\/inaccessible/);
 f.state.denied.clear();f.state.protected.add('a1');await assert.rejects(()=>f.inspect('trash'),/Personnel Records/);
 f.state.protected.clear();f.state.locks.add('a1');await assert.rejects(()=>f.inspect('trash'),/edit lock/);
});
await check('unauthorized actor offboarding after preview prevents commit',async()=>{
 const f=fixture(),v=await f.inspect('trash');f.state.actor.archived=true;
 await assert.rejects(()=>f.run(v,'trash','trashjob'),/initiating account is no longer active/);assert.equal(f.state.entries.length,0);
});
await check('stale restore preview rejects changed revision without partial restoration',async()=>{
 const f=fixture();await f.run(await f.inspect('trash'),'trash','trashjob');
 const snapshot=await f.inspect('restore');f.state.items.get('a1').revision++;
 await assert.rejects(()=>f.run(snapshot,'restore','restorejob'),/Hierarchy or permissions changed/);
 assert.equal(f.state.items.get('a').status,'trashed');assert.equal(f.state.entries.filter(e=>e.restoredAt).length,0);
});
await check('new restore preview allows harmless metadata revision changes while preserving lineage',async()=>{
 const f=fixture();await f.run(await f.inspect('trash'),'trash','trashjob');
 f.state.items.get('a1').title='Revised note';f.state.items.get('a1').revision++;
 const fresh=await f.inspect('restore');await f.run(fresh,'restore','restorejob');
 assert.equal(f.state.items.get('a1').title,'Revised note');assert.equal(f.state.items.get('a1').status,'active');
});
await check('failed provenance persistence rolls back modifications and checkpoint',async()=>{
 const f=fixture(),v=await f.inspect('trash');f.state.failEvidence=true;
 await assert.rejects(()=>f.run(v,'trash','trashjob'),/evidence persistence failure/);
 assert.equal(f.state.items.get('a').status,'active');assert.equal(f.state.entries.length,0);assert.equal(f.state.checkpoints.get('trashjob').nextIndex,0);
 f.state.failEvidence=false;await f.run(v,'trash','trashjob');assert.equal(f.state.entries.length,2);
});
await check('lost progress acknowledgement resumes without applying root twice',async()=>{
 const f=fixture(),v=await f.inspect('trash');let fails=0;
 await assert.rejects(()=>f.run(v,'trash','trashjob',{progress:()=>{if(!fails++)throw Error('response lost')}}),/response lost/);
 assert.equal(f.state.checkpoints.get('trashjob').nextIndex,1);
 const result=await f.run(v,'trash','trashjob');assert.equal(result.changed,2);assert.equal(f.state.entries.length,2);assert.equal(f.state.items.get('a').revision,2);
});
await check('layered archive over outstanding trash or layered trash over archive blocked',async()=>{
 const f=fixture();await f.run(await f.inspect('archive'),'archive','archivejob');
 await assert.rejects(()=>f.inspect('trash'),/existing hierarchy operation/);
});
await check('managed folders, overlapping roots and cross-project descendants blocked',async()=>{
 const f=fixture();f.state.items.get('a1').projectId='other';await assert.rejects(()=>f.inspect('archive'),/ownership scopes/);
 f.state.items.get('a1').projectId='p';f.state.items.get('a').source='project-folder';await assert.rejects(()=>f.inspect('archive'),/managed/);
 f.state.items.get('a').source='manual';await assert.rejects(()=>f.inspect('archive',[{id:'a',revision:1},{id:'a1',revision:1}]),/overlap/);
});
await check('changed roots rejected before write',async()=>{
 const f=fixture(),v=await f.inspect('trash');f.state.items.get('a').revision++;
 await assert.rejects(()=>f.run(v,'trash','trashjob'),/Selected items or edit permissions changed/);
});
await check('multi-root interruption commits exactly one root and resumes from checkpoint',async()=>{
 const f=fixture();const roots=[{id:'a',revision:1},{id:'b',revision:1}];const preview=await f.inspect('archive',roots);
 let acknowledgements=0;
 await assert.rejects(()=>f.run(preview,'archive','multi',{progress:()=>{if(++acknowledgements===1)throw Error('ack lost')}}),/ack lost/);
 assert.equal(f.state.items.get('a').status,'archived');assert.equal(f.state.items.get('b').status,'active');
 assert.equal(f.state.checkpoints.get('multi').nextIndex,1);
 const output=await f.run(preview,'archive','multi');assert.equal(output.changed,4);
 assert.equal(f.state.items.get('b1').status,'archived');
 assert.equal(f.state.entries.filter(e=>e.jobId==='multi').length,4);
 assert.equal(f.state.activity.length,2);
 const onlyB=await f.inspect('restore',[{id:'b',revision:f.state.items.get('b').revision}]);
 await f.run(onlyB,'restore','restore-b');
 assert.equal(f.state.items.get('a').status,'archived');assert.equal(f.state.items.get('b').status,'active');
});
await check('permission revoked after first committed root preserves first but denies second',async()=>{
 const f=fixture();const preview=await f.inspect('trash',[{id:'a',revision:1},{id:'b',revision:1}]);let updates=0;
 await assert.rejects(()=>f.run(preview,'trash','multi',{progress:()=>{if(++updates===1)f.state.denied.add('b1')}}),/protected\/inaccessible/);
 assert.equal(f.state.items.get('a').status,'trashed');assert.equal(f.state.items.get('b').status,'active');
 assert.equal(f.state.entries.filter(e=>e.jobId==='multi').length,2);
});
await check('cancelled operations do not create marks',async()=>{
 const f=fixture(),v=await f.inspect('trash');await assert.rejects(()=>f.run(v,'trash','trashjob',{cancel:()=>true}),/cancelled/);
 assert.equal(f.state.entries.length,0);
});
console.log(`R62 hierarchy lifecycle: ${count}/${count} executable checks passed`);
