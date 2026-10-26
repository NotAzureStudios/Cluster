/** R64 executable ownership inspection checks. Source-level filesystem fixtures,
 * not live PostgreSQL, NAS, S3 or Windows certification. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const file='apps/server/src/domains/library/library-disposition-ownership.ts';
const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true});
assert.equal(compiled.diagnostics?.length||0,0);
const mod={exports:{}};
const localRequire=(specifier)=>{
 if(specifier==='./library-disposition-related-authority.js') {
  const fileName='apps/server/src/domains/library/library-disposition-related-authority.ts';
  const related=ts.transpileModule(fs.readFileSync(fileName,'utf8'),{fileName,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
  const nested={exports:{}};
  vm.runInNewContext(related.outputText,{module:nested,exports:nested.exports,require,process,Date,Math,JSON,Object,Number,Boolean,String,Promise,Set,Map,Error,Buffer},{filename:fileName});
  return nested.exports;
 }
 return require(specifier);
};
vm.runInNewContext(compiled.outputText,{module:mod,exports:mod.exports,require:localRequire,process,Date,Math,JSON,Object,Number,Boolean,String,Promise,Set,Map,Error,Buffer},{filename:file});
const { canonicalDispositionKey,inspectLibraryStorageOwnership,LIBRARY_OWNERSHIP_LIMITS }=mod.exports;
let passed=0;
async function test(label,body){await body();passed++;console.log('PASS',label);}
const root=await fsp.mkdtemp(path.join(os.tmpdir(),'cluster-r64-'));
const filePath=path.join(root,'source.bin');
await fsp.writeFile(filePath,'immutable source bytes');
const rows={libraryItem:[{id:'item',fileName:'source.bin',revision:5,status:'trashed',legalHold:false,retentionUntil:null}],libraryVersion:[],libraryDerivative:[]};
function harness(data=rows){return {
 libraryItem:{findUnique:async({where})=>data.libraryItem.find(row=>row.id===where.id)||null,
   findMany:async(args)=>find(data.libraryItem,'fileName',args)},
 libraryVersion:{findMany:async(args)=>find(data.libraryVersion,'fileName',args)},
 libraryDerivative:{findMany:async(args)=>find(data.libraryDerivative,'storagePath',args)},
 managedBlob:{findMany:async()=>[]},uploadSession:{findMany:async()=>[]},
 packetRelease:{findMany:async()=>[]},packetReleaseDerivative:{count:async()=>0},
};}
function find(arr,field,args){const results=arr.filter(row=>args.where?.itemId ? row.itemId===args.where.itemId : true)
 .filter(row=>args.where?.id?.gt?row.id>args.where.id.gt:true)
 .filter(row=>args.where?.[field]?.not===null?row[field]!=null:true)
 .sort((a,b)=>a.id.localeCompare(b.id))
 .slice(0,args.take).map(row=>Object.fromEntries(Object.keys(args.select||{}).filter(k=>args.select[k] && row[k]!==undefined).map(k=>[k,row[k]])));
 return results;}
const inspect=(prisma=harness())=>inspectLibraryStorageOwnership({prisma,itemId:'item',libraryRoot:root});
await test('local file found with explicit non-destructive response',async()=>{
 const r=await inspect();assert.equal(r.objects[0].state.state,'PRESENT');assert.equal(r.quarantineAllowed,false);
 assert.equal(r.physicalDisposalAllowed,false);assert.equal(r.ownerRecordsScanned,1);
 assert.equal(r.databaseInventoryComplete,true);assert.equal(r.providerInventoryComplete,false);
 assert.ok(r.blockers.includes('BACKUP_RETENTION_UNVERIFIED'));
});
await test('revision and derivative owners included, even when sharing a source path',async()=>{
 const data={libraryItem:[...rows.libraryItem],libraryVersion:[{id:'version',itemId:'item',fileName:'source.bin'}],
 libraryDerivative:[{id:'derivative',itemId:'item',storagePath:'source.bin'}]};
 const r=await inspect(harness(data));assert.equal(r.objects.length,3);assert.equal(r.ownerRecordsScanned,3);
 assert.ok(r.blockers.includes('MULTIPLE_RECORD_REFERENCES'));assert.equal(r.objects[0].owners.length,3);
});
await test('a distinct Library item sharing bytes blocks ownership',async()=>{
 const data={...rows,libraryItem:[...rows.libraryItem,{id:'other',fileName:'source.bin'}]};
 const r=await inspect(harness(data));assert.ok(r.blockers.includes('SHARED_LIBRARY_OWNERSHIP'));
 assert.equal(r.objects[0].owners.some(o=>o.itemId==='other'),true);
});
await test('full owner scan paginates rather than relying on a single page',async()=>{
 const other=[];for(let i=0;i<1200;i++)other.push({id:`other-${String(i).padStart(4,'0')}`,fileName:`other-${i}.bin`});
 const data={...rows,libraryItem:[rows.libraryItem[0],...other]};
 const r=await inspect(harness(data));assert.equal(r.ownerRecordsScanned,1201);
});
for(const invalid of ['../outside','nested/../../secret','/etc/passwd','C:\\secret.txt','C:/secret.txt','\\\\server\\share\\blob','./source.bin','nested//blob','nested\\blob','source.bin\0']){
 await test(`reject path grammar ${JSON.stringify(invalid)}`,()=>assert.equal(canonicalDispositionKey(root,invalid),null));
}
await test('absolute path under trusted root remains invalid',()=>assert.equal(canonicalDispositionKey(root,filePath),null));
await test('unreadable, unsafe and external candidates are blockers, not empty success',async()=>{
 const data={...rows,libraryItem:[{...rows.libraryItem[0],fileName:'../outside'}]};
 const r=await inspect(harness(data));assert.ok(r.blockers.includes('UNSAFE_OR_EXTERNAL_PATH'));
 assert.equal(r.objects[0].state,'UNSAFE_OR_EXTERNAL_PATH');
});
await test('missing local bytes never become delete-eligible',async()=>{
 const data={...rows,libraryItem:[{...rows.libraryItem[0],fileName:'missing.bin'}]};
 const r=await inspect(harness(data));assert.ok(r.blockers.includes('STORAGE_MISSING'));
});
await test('symlink points into or outside root are never accepted',async()=>{
 await fsp.symlink(filePath,path.join(root,'shortcut.bin'));
 const data={...rows,libraryItem:[{...rows.libraryItem[0],fileName:'shortcut.bin'}]};
 const r=await inspect(harness(data));assert.ok(r.blockers.includes('STORAGE_SYMLINK_OR_JUNCTION'));
});
await test('hard-linked file is explicitly blocked',async()=>{
 await fsp.link(filePath,path.join(root,'linked.bin'));
 const r=await inspect();assert.ok(r.blockers.includes('STORAGE_HARDLINKED'));
});
await test('matching ownership bound fails closed for overshared objects',async()=>{
 const data={...rows,libraryItem:[...rows.libraryItem]};
 data.libraryVersion=Array.from({length:LIBRARY_OWNERSHIP_LIMITS.matchingReferences+1},(_,i)=>({id:`v${String(i).padStart(5,'0')}`,itemId:'other',fileName:'source.bin'}));
 await assert.rejects(inspect(harness(data)),/LIBRARY_OWNERSHIP_MATCH_LIMIT/);
});
await test('record changing during scan is marked as stale evidence',async()=>{
 const h=harness();let reads=0;const original=h.libraryItem.findUnique;
 h.libraryItem.findUnique=async(args)=>{const item=await original(args);return {...item,revision:++reads===1?5:6};};
 const r=await inspect(h);assert.ok(r.blockers.includes('ITEM_CHANGED_DURING_AUDIT'));
});
await test('source pointer disappearing during scan blocks evidence',async()=>{
 const h=harness();h.libraryItem.findMany=async()=>[];
 const r=await inspect(h);assert.ok(r.blockers.includes('SOURCE_POINTER_CHANGED_DURING_AUDIT'));
});
await test('candidate cap fails rather than silently truncating' ,async()=>{
 const data={...rows,libraryVersion:Array.from({length:LIBRARY_OWNERSHIP_LIMITS.candidates+1},(_,i)=>({id:`v${String(i).padStart(3,'0')}`,itemId:'item',fileName:`f${i}`}))};
 await assert.rejects(inspect(harness(data)),/LIBRARY_OWNERSHIP_CANDIDATE_LIMIT/);
});
await test('stalled database paging fails the inventory',async()=>{
 const bad=harness();bad.libraryItem.findMany=async()=>[{id:'a',fileName:'source.bin'}];
 await assert.rejects(inspect(bad),/LIBRARY_OWNERSHIP_CURSOR_STALLED/);
});
await test('stable source scan fingerprint for unchanged storage evidence',async()=>{
 await fsp.unlink(path.join(root,'linked.bin'));const a=await inspect();const b=await inspect();assert.equal(a.fingerprint,b.fingerprint);
});
await test('R65 version pointer mutation during scan invalidates ownership evidence',async()=>{
 const data={...rows,libraryVersion:[{id:'v1',itemId:'item',fileName:'source.bin',checksumSha256:'a'.repeat(64)}]};
 const h=harness(data);const base=h.libraryVersion.findMany;let itemReads=0;
 h.libraryVersion.findMany=async(args)=>{
   const original=await base(args);
   if(args.where?.itemId && ++itemReads===2) return original.map(row=>({...row,fileName:'changed.bin'}));
   return original;
 };
 const r=await inspect(h);assert.ok(r.blockers.includes('CHILD_POINTERS_CHANGED_DURING_AUDIT'));
 assert.equal(r.quarantineAllowed,false);
});
await test('R65 a new derivative discovered after inventory invalidates evidence',async()=>{
 const h=harness();const base=h.libraryDerivative.findMany;let itemReads=0;
 h.libraryDerivative.findMany=async(args)=>{
   const original=await base(args);
   if(args.where?.itemId && ++itemReads===2) return [{id:'new',itemId:'item',storagePath:'new.bin',contentChecksumSha256:'b'.repeat(64)}];
   return original;
 };
 const r=await inspect(h);assert.ok(r.blockers.includes('CHILD_POINTERS_CHANGED_DURING_AUDIT'));
});
await test('R65 root content checksum mutation invalidates evidence',async()=>{
 const h=harness();let reads=0;const original=h.libraryItem.findUnique;
 h.libraryItem.findUnique=async(args)=>({...await original(args),checksumSha256:(++reads===1?'a':'b').repeat(64)});
 const r=await inspect(h);assert.ok(r.blockers.includes('ITEM_CHANGED_DURING_AUDIT'));
});
await fsp.rm(root,{recursive:true,force:true});
console.log(`R64 ownership focused checks ${passed}/${passed}`);
