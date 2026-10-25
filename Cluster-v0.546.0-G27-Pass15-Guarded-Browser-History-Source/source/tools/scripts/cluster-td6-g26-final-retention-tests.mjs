#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);const ts=require('typescript');
const code=ts.transpileModule(readFileSync('apps/server/src/domains/library/library-effective-retention.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const module={exports:{}};new Function('require','module','exports',code)(require,module,module.exports);
const {resolveLibraryEffectiveRetention,LibraryRetentionLineageError}=module.exports;
let checks=0;async function test(label,fn){await fn();checks++;console.log('PASS G26 inherited retention',label)}
const nextYear='2028-12-31T00:00:00Z';
function fixture(items){let calls=0;return {db:{libraryItem:{findUnique:async({where})=>{calls++;return items[where.id]||null}}},calls:()=>calls}}
await test('child inherits the longest ancestor retention deadline and all holds',async()=>{
 const items={root:{id:'root',parentId:null,projectId:'p',revision:1,retentionUntil:nextYear,legalHold:true},
 mid:{id:'mid',parentId:'root',projectId:'p',revision:3,retentionUntil:'2027-01-01T00:00:00Z',legalHold:false},
 leaf:{id:'leaf',parentId:'mid',projectId:'p',revision:9,retentionUntil:null,legalHold:false}};
 const f=fixture(items);const result=await resolveLibraryEffectiveRetention(f.db,items.leaf);
 assert.equal(result.legalHold,true);assert.equal(result.retentionUntil.toISOString(),'2028-12-31T00:00:00.000Z');
 assert.deepEqual([...result.governingIds],['mid','root']);assert.equal(result.lineage.length,3);
 assert.equal(result.lineage[0].revision,9);assert.equal(f.calls(),2);
});
await test('no inherited protection when lineage is clear',async()=>{
 const item={id:'r',parentId:null,legalHold:false,retentionUntil:null,revision:1};
 const r=await resolveLibraryEffectiveRetention(fixture({r:item}).db,item);
 assert.equal(r.legalHold,false);assert.equal(r.retentionUntil,null);assert.equal(r.lineage.length,1);
});
await test('missing parent fails closed',async()=>{
 await assert.rejects(resolveLibraryEffectiveRetention(fixture({}).db,{id:'leaf',parentId:'missing'}),e=>e.code==='LIBRARY_RETENTION_PARENT_MISSING');
});
await test('cycles cannot bypass policy',async()=>{
 const rows={a:{id:'a',parentId:'b',revision:1},b:{id:'b',parentId:'a',revision:1}};
 await assert.rejects(resolveLibraryEffectiveRetention(fixture(rows).db,rows.a),e=>e.code==='LIBRARY_RETENTION_CYCLE');
});
await test('cross-project folder ancestry is rejected',async()=>{
 const rows={parent:{id:'parent',parentId:null,projectId:'other',revision:1}};
 await assert.rejects(resolveLibraryEffectiveRetention(fixture(rows).db,{id:'leaf',projectId:'mine',parentId:'parent'}),e=>e.code==='LIBRARY_RETENTION_PROJECT_BOUNDARY');
});
await test('corrupt ancestor dates fail closed',async()=>{
 const rows={parent:{id:'parent',parentId:null,retentionUntil:'bogus'}};
 await assert.rejects(resolveLibraryEffectiveRetention(fixture(rows).db,{id:'leaf',parentId:'parent'}),e=>e.code==='LIBRARY_RETENTION_INVALID_DATE');
});
await test('deep lineages are bounded and cannot be reported safe',async()=>{
 const rows={};for(let i=0;i<129;i++)rows['i'+i]={id:'i'+i,parentId:i<128?'i'+(i+1):null};
 await assert.rejects(resolveLibraryEffectiveRetention(fixture(rows).db,rows.i0),e=>e.code==='LIBRARY_RETENTION_ANCESTOR_LIMIT');
});
await test('ancestor revisions are included in a disposition snapshot fingerprint',()=>{
 const source=readFileSync('apps/server/src/domains/library/library-disposition.ts','utf8');
 const hier=readFileSync('apps/server/src/domains/library/library-hierarchy-lifecycle.ts','utf8');
 const route=readFileSync('apps/server/src/domains/library/library-routes.ts','utf8');
 assert.match(source,/resolveLibraryEffectiveRetention\(tx, item\)/);
 assert.match(source,/retentionLineage: effectiveRetention.lineage/);
 assert.match(source,/effectiveRetentionUntil: effectiveRetention.retentionUntil/);
 assert.match(hier,/ancestorProtection.lineage/);assert.match(hier,/LIBRARY_HIERARCHY_INHERITED_RETENTION/);
 assert.match(route,/effectiveRetention: \{ legalHold: effective.legalHold/);
});
console.log(`G26 effective retention: ${checks}/${checks} passed`);
