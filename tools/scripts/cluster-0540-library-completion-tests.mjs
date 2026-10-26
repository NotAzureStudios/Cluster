import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const routes = read('../../apps/server/src/domains/library/library-9e2-routes.ts');
const ui = read('../../packages/renderer/src/features/library/LibraryWorkspacePage.tsx');
const compilerCode = read('../../apps/server/src/core/prisma-semantic-query.ts');
const mediaCode = read('../../apps/server/src/domains/library/library-media-filters.ts');
const platformCode = read('../../apps/server/src/domains/library/library-platform-9e2.ts');
function compile(source, dependency = () => { throw new Error('Unknown dependency'); }) {
 const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const out = {};
 new Function('exports','require',code)(out,dependency);
 return out;
}
const semantic = compile(compilerCode);
const media = compile(mediaCode);
const platform = compile(platformCode, name => {
 if(name==='node:crypto') return require('node:crypto');
 if(name==='node:path') return require('node:path');
 if(name==='@cluster/shared') return {LIBRARY_DATA_FIELDS:[{id:'parentId',type:'text',filterable:true},{id:'status',type:'status',filterable:true},{id:'title',type:'text',filterable:true}]};
 if(name==='../../core/data-query.js') return {normalizeClusterDataQuery: value => ({...value,sorts:value.sorts || [],page:{limit:250}})};
 if(name==='../../core/prisma-semantic-query.js') return semantic;
 if(name==='./library-media-filters.js') return media;
 throw new Error(name);
});
let total=0;
async function test(name,run) {await run(); total++; console.log('PASS',name);}
await test('canonical descendant rule survives normalization and compilation', () => {
 const query={folderScope:{mode:'descendants',folderId:'folder-A'},filters:{logic:'and',conditions:[{fieldId:'status',operator:'equals',value:'active'}]}};
 const normalized=platform.librarySmartCollectionWhere(query);
 assert.deepEqual(normalized.query.folderScope,query.folderScope);
 assert.deepEqual(JSON.parse(JSON.stringify(normalized.query)).folderScope,query.folderScope);
 assert.ok(normalized.where.AND);
});
await test('rejects malformed, overlong and rootless scope', () => {
 for (const folderScope of [{mode:'descendants'},{mode:'all',folderId:'A'},{mode:'descendants',folderId:''},{mode:'descendants',folderId:'x'.repeat(241)},[],null]) {
  assert.throws(()=>platform.librarySmartCollectionQuery({folderScope}),/folder scope|folder ID/i);
 }
});
await test('regular collection query and exact folder filter are preserved', () => {
 const query=platform.librarySmartCollectionWhere({filters:{logic:'and',conditions:[{fieldId:'parentId',operator:'equals',value:'folder-A'}]}});
 assert.equal(query.query.folderScope,undefined);
 assert.equal(query.where.AND[1].AND[0].parentId,'folder-A');
});
await test('live traversal includes newly moved subfolders and tolerates cycles', async()=>{
 const hierarchy=new Map([['A',['B','C']],['B',['D']],['C',[]],['D',[]]]);
 const fetch=async parents => parents.flatMap(p=>(hierarchy.get(p)||[]).map(id=>({id})));
 assert.deepEqual(await platform.librarySmartCollectionDescendantFolders('A',fetch),['A','B','C','D']);
 hierarchy.set('D',['A','E']);
 assert.deepEqual(await platform.librarySmartCollectionDescendantFolders('A',fetch),['A','B','C','D','E']);
});
await test('oversized folder trees fail closed', async()=>{
 await assert.rejects(platform.librarySmartCollectionDescendantFolders('A',async parents => parents.includes('A') ? [{id:'B'},{id:'C'}] : [],2),/safe folder limit/);
});
await test('pathological hierarchy depth fails closed', async()=>{
 await assert.rejects(platform.librarySmartCollectionDescendantFolders('0',async parents=>parents.map(p=>({id:String(Number(p)+1)}))),/too deep/);
});
await test('server validates folder authorization at create, update, and browse',()=>{
 assert.match(routes,/normalized\?\.query\.folderScope && \(await authorizedCollectionScope/);
 assert.match(routes,/updatedQuery\?\.query\.folderScope && \(await authorizedCollectionScope/);
 assert.match(routes,/const folderWhere = await authorizedCollectionScope\(request, reply, compiled\)/);
 assert.match(routes,/libraryAccess\.canAccessItem\(request, anchor, "view"\)/);
 assert.match(routes,/folderWhere \? \[folderWhere\] : \[\]/);
});
await test('folder anchors checked before traversal and item metadata filtered by policy',()=>{
 assert.match(routes,/anchor\.type !== "folder"/);
 assert.match(routes,/status: \{ notIn: \["trashed", "archived"\] \}/);
 assert.match(routes,/prisma\.personnelRecordAttachment\.findMany/);
 assert.match(routes,/rows\.filter\(\(item\) => !protectedIds\.has\(item\.id\)\)/);
 assert.equal((routes.match(/filterCollectionItems\(request, rows\)/g)||[]).length,2);
});
await test('single-item membership changes require revision-qualified transaction',()=>{
 assert.match(routes,/app\.delete\("\/api\/library\/collections\/:collectionId\/items\/:itemId"/);
 assert.match(routes,/expectedCollectionRevision: z\.number\(\)\.int\(\)\.positive\(\)/);
 assert.match(routes,/updateMany\(\{ where: \{ id: collectionId, ownerId: access\.collection\.ownerId, archived: false, revision: body\.expectedCollectionRevision \}/);
 assert.match(routes,/isolationLevel: "Serializable"/);
});
await test('UI saves descendant scope and offers server-bounded matching selection',()=>{
 assert.match(ui,/folderScope: \{ mode: "descendants", folderId \}/);
 assert.match(ui,/Select matching \(max \{MAX_LIBRARY_BULK_IDS\}\)/);
 assert.match(ui,/api\/library\/bulk\/select-matching/);
 assert.match(ui,/selection\.selectedCount !== selection\.items\.length/);
 assert.match(ui,/serial !== requestSerial\.current/);
 assert.match(ui,/captureLibraryBulkRevisions\(ids, items\)/);
 assert.match(ui,/if \(checked && !selectedIds\.has\(item\.id\) && selectedIds\.size >= MAX_LIBRARY_BULK_IDS\)/);
});
console.log(`PASS ${total}/${total} Library completion tests`);

// Execute the registered Fastify handlers with an in-memory data adapter.
// This verifies the API actually intersects the live subtree and Records policy.
const chain = new Proxy({}, { get(_target, key) { if (key === 'parse') return (value) => value; return () => chain; } });
const z = new Proxy({}, { get(_target, key) { if (key === 'coerce') return new Proxy({}, { get: () => () => chain }); return () => chain; } });
const pagination = compile(read('../../apps/server/src/domains/library/library-collection-pagination.ts'));
const mocks = {
 'node:fs': require('node:fs'), 'node:fs/promises': require('node:fs/promises'), 'node:path': require('node:path'),
 'zod': { z },
 './library-platform-9e2.js': {...platform, LIBRARY_REVIEW_STATES:['draft'], LIBRARY_TRANSFER_CONFLICT_POLICIES:['reject'], libraryLockConflict:()=>null,libraryLockIsActive:()=>false},
 './library-collection-pagination.js': pagination,
 './library-matching-selection.js': compile(read('../../apps/server/src/domains/library/library-matching-selection.ts')),
 './library-collection-access.js': compile(read('../../apps/server/src/domains/library/library-collection-access.ts')),
 '../../core/uploads.js': {untrustedFileResponseHeaders:()=>({})},
 '../media/resource-delivery.js': {sendStoredResource:()=>undefined},
 '../../core/library.js': {libraryMimeGroup:()=> 'other', libraryPreviewKind:()=> 'none', parseLibraryMetadata:()=>({})},
 '../uploads/upload-session-runtime.js': {uploadPressureSnapshot:async()=>({})},
 '../sessions/device-proof.js': {requestDeviceProof:()=>null},
};
const routeModule=compile(routes, name=>mocks[name]||{});
const actions = new Map();
const app = Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,(url,handler)=>actions.set(`${method} ${url}`,handler)]));
let anchorVisible=true;
let currentActor="owner";
const shareRoles={ reader:"viewer", editor:"editor" };
const collectionAccessActivity=[];
let scopeRevision=3;
let collectionKind="smart";
let accessDenied=false;
const folders=[{id:'sub',parentId:'root',type:'folder',status:'active'}, {id:'nested',parentId:'sub',type:'folder',status:'active'}];
const files=[
 {id:'visible',parentId:'nested',type:'file',title:'Allowed',status:'active',revision:2,metadata:'{}'},
 {id:'records',parentId:'sub',type:'file',title:'Private HR',status:'active',revision:2,metadata:'{}'},
 {id:'outside',parentId:'somewhere',type:'file',title:'Outside',status:'active',revision:2,metadata:'{}'},
];
let lastSelectionIsolation=null;
const db={
 libraryCollection:{
  findUnique:async()=>({id:'col',ownerId:'owner',archived:false,revision:scopeRevision,kind:collectionKind,projectId:null,grants:shareRoles[currentActor]?[{userId:currentActor,role:shareRoles[currentActor]}]:[],queryJson:JSON.stringify({folderScope:{mode:'descendants',folderId:'root'}})}),
  updateMany:async({where})=>{if(where.revision!==scopeRevision)return {count:0};scopeRevision++;return {count:1};},
 },
 libraryCollectionGrant:{
  upsert:async({where,create,update})=>{const id=where.collectionId_userId.userId;shareRoles[id]=(shareRoles[id]?update:create).role;},
  deleteMany:async({where})=>{const present=Boolean(shareRoles[where.userId]);delete shareRoles[where.userId];return {count:present?1:0};},
 },
 activityEvent:{create:async({data})=>{collectionAccessActivity.push(data);return data;}},
 user:{findUnique:async({where})=>({id:where.id,archived:false,accountState:where.id==='inactive'?'DISABLED':'ACTIVE',accessExpiresAt:null})},
 $transaction:async(run,opts)=>{lastSelectionIsolation=opts?.isolationLevel ?? null;return run(db);},
 libraryItem:{
  findUnique:async ({where})=>where.id==='root'?{id:'root',type:'folder',status:'active',lifecycleState:'active'}:null,
  findMany:async ({where,select,take,skip=0})=> {
   const parentIn=select?where.parentId.in:where.AND?.find(q=>q.parentId?.in)?.parentId.in;
   const eligible=(select?folders:files).filter(item=>parentIn.includes(item.parentId));
   return eligible.slice(skip,skip+take);
  },
 },
 libraryCollectionMembership:{findMany:async ({skip=0,take=250})=>files.map((item)=>({item})).slice(skip,skip+take)},
 personnelRecordAttachment:{findMany:async()=>[{libraryItemId:'records'}]},
};
routeModule.registerLibrary9E2Routes({app,prisma:db,operationRuntime:{},collaborationRuntime:{},libraryAccess:{
 canAccessItem:async()=>anchorVisible,
 accessContext:async()=>({user:{id:currentActor}}),
 visibleFor:()=>!accessDenied,
 filterItems:async(_request,rows)=>accessDenied?[]:rows,
},dataLayout:{},storageRuntime:{},getCurrentUser:async()=>({id:currentActor}),decorateUserForClient:async()=>({isAdmin:false,workspaceRole:'owner'}),hasToolPermission:()=>true,logActivity:async()=>{}});
const browse=actions.get('get /api/library/collections/:collectionId/items');
const request = {params:{collectionId:'col'},query:{limit:100}};
function reply() {return {status:200,code(status){this.status=status;return this;},send(payload){this.payload=payload;return payload;}};}
await test('runtime: recursive collection excludes unrelated and Personnel Record files',async()=>{
 const result=await browse(request,reply());
 assert.deepEqual(result.items.map(item=>item.id),['visible']);
 assert.equal(result.collection.revision,3);
});
await test('runtime: access revocation blocks the entire scoped collection',async()=>{
 anchorVisible=false;
 const res=reply();
 const result=await browse(request,res);
 assert.equal(res.status,403);
 assert.equal(result,undefined);
 assert.equal(res.payload.code,'LIBRARY_COLLECTION_FOLDER_DENIED');
 anchorVisible=true;
});
await test('runtime: old cursor cannot be reused after collection changes',async()=>{
 scopeRevision=4;
 const res=reply();
 const result=await browse({...request,query:{limit:100,cursor:'v3:o100'}},res);
 assert.equal(res.status,409);
 assert.equal(res.payload.code,'LIBRARY_COLLECTION_CURSOR_STALE');
 assert.equal(result.code,'LIBRARY_COLLECTION_CURSOR_STALE');
});
console.log(`PASS ${total}/${total} Library completion checks including runtime handler tests`);

await test('runtime: a granted viewer can browse only Library-ACL-visible items',async()=>{
 currentActor='reader';
 const result=await browse(request,reply());
 assert.deepEqual(result.items.map(item=>item.id),['visible']);
 assert.equal(result.collection.accessRole,'viewer');
 assert.equal(result.collection.itemCount,undefined);
 currentActor='owner';
});
await test('runtime: an ungranted person cannot browse collection details',async()=>{
 currentActor='stranger';
 const res=reply();
 const result=await browse(request,res);
 assert.equal(res.status,403);
 assert.equal(res.payload.code,'LIBRARY_COLLECTION_ACCESS_DENIED');
 assert.equal(result,undefined);
 currentActor='owner';
});
await test('runtime: viewer cannot mutate manual membership',async()=>{
 currentActor='reader';
 const res=reply();
 await actions.get('post /api/library/collections/:collectionId/items')({params:{collectionId:'col'},body:{}},res);
 assert.equal(res.status,403);
 assert.equal(res.payload.code,'LIBRARY_COLLECTION_ACCESS_DENIED');
 currentActor='owner';
});
await test('runtime: editor cannot mutate collection definition or grants',async()=>{
 currentActor='editor';
 for(const route of ['patch /api/library/collections/:collectionId','put /api/library/collections/:collectionId/shares/:userId']){
  const res=reply();
  await actions.get(route)({params:{collectionId:'col',userId:'reader'},body:{}},res);
  assert.equal(res.status,403);
  assert.equal(res.payload.code,'LIBRARY_COLLECTION_ACCESS_DENIED');
 }
 currentActor='owner';
});
console.log(`PASS ${total}/${total} Library runtime sharing authorization checks`);

await test('runtime: owner grant commits a new editor and activity record',async()=>{
 currentActor='owner';
 const before=scopeRevision;
 const result=await actions.get('put /api/library/collections/:collectionId/shares/:userId')({params:{collectionId:'col',userId:'collaborator'},body:{role:'editor',expectedRevision:before}},reply());
 assert.equal(result.ok,true);assert.equal(result.collection.revision,before+1);
 assert.equal(shareRoles.collaborator,'editor');
 assert.equal(collectionAccessActivity.at(-1).entityType,'library_collection');
 assert.equal(JSON.parse(collectionAccessActivity.at(-1).metadata).recipientId,'collaborator');
});
await test('runtime: shared editor may browse collection but not edit its sharing policy',async()=>{
 currentActor='collaborator';
 const read=await browse(request,reply());
 assert.equal(read.collection.accessRole,'editor');
 const denied=reply();
 await actions.get('get /api/library/collections/:collectionId/shares')({params:{collectionId:'col'}},denied);
 assert.equal(denied.status,403);
 currentActor='owner';
});
await test('runtime: stale owner grant fails with conflict, leaving previous role intact',async()=>{
 const staleRevision=scopeRevision-1;
 const res=reply();
 const result=await actions.get('put /api/library/collections/:collectionId/shares/:userId')({params:{collectionId:'col',userId:'collaborator'},body:{role:'viewer',expectedRevision:staleRevision}},res);
 assert.equal(res.status,409);assert.equal(result.code,'LIBRARY_COLLECTION_REVISION_CONFLICT');
 assert.equal(shareRoles.collaborator,'editor');
});
await test('runtime: inactive recipients are rejected without revision changes',async()=>{
 const current=scopeRevision;const res=reply();
 const result=await actions.get('put /api/library/collections/:collectionId/shares/:userId')({params:{collectionId:'col',userId:'inactive'},body:{role:'viewer',expectedRevision:current}},res);
 assert.equal(res.status,409);assert.equal(result.code,'LIBRARY_COLLECTION_RECIPIENT_UNAVAILABLE');
 assert.equal(scopeRevision,current);
});
await test('runtime: revoke removes access and creates audit evidence in transaction',async()=>{
 const res=reply();
 const result=await actions.get('delete /api/library/collections/:collectionId/shares/:userId')({params:{collectionId:'col',userId:'collaborator'},body:{expectedRevision:scopeRevision}},res);
 assert.equal(result.ok,true);assert.equal(shareRoles.collaborator,undefined);
 assert.equal(JSON.parse(collectionAccessActivity.at(-1).metadata).action,'revoke');
 currentActor='collaborator';
 const denied=reply();await browse(request,denied);assert.equal(denied.status,403);
 currentActor='owner';
});
console.log(`PASS ${total}/${total} Library grant mutation runtime tests`);


// R33: exercise the new server-owned Collection selection handler rather than
// merely relying on source patterns. The operation never grants Library access.
const selectCollection=actions.get('post /api/library/collections/:collectionId/select-matching');
await test('R33: owner selects exact accessible Smart Collection members, excluding Records',async()=>{
 const result=await selectCollection({params:{collectionId:'col'},body:{expectedCollectionRevision:scopeRevision}},reply());
 assert.equal(result.ok,true);assert.deepEqual(result.items.map(item=>item.id),['visible']);
 assert.equal(result.collectionRevision,scopeRevision);assert.equal(result.selectedCount,1);
 assert.equal(lastSelectionIsolation,'RepeatableRead');
});
await test('R33: granted viewer can select only ACL-visible collection items',async()=>{
 currentActor='reader';accessDenied=true;
 const result=await selectCollection({params:{collectionId:'col'},body:{expectedCollectionRevision:scopeRevision}},reply());
 assert.equal(result.ok,true);assert.deepEqual(result.items,[]);
 accessDenied=false;currentActor='owner';
});
await test('R33: ungranted actor cannot request collection snapshots',async()=>{
 currentActor='stranger';const res=reply();
 await selectCollection({params:{collectionId:'col'},body:{expectedCollectionRevision:scopeRevision}},res);
 assert.equal(res.status,403);assert.equal(res.payload.code,'LIBRARY_COLLECTION_ACCESS_DENIED');currentActor='owner';
});
await test('R33: stale collection revisions block a selection before reading members',async()=>{
 const res=reply();const result=await selectCollection({params:{collectionId:'col'},body:{expectedCollectionRevision:scopeRevision-1}},res);
 assert.equal(res.status,409);assert.equal(result.code,'LIBRARY_COLLECTION_REVISION_CONFLICT');
});
await test('R33: Manual Collection selection reads explicit members, not a Smart query',async()=>{
 collectionKind='manual';
 const result=await selectCollection({params:{collectionId:'col'},body:{expectedCollectionRevision:scopeRevision}},reply());
 assert.equal(result.ok,true);
 assert.deepEqual(result.items.map(item=>item.id),['visible','outside']);
 collectionKind='smart';
});
await test('R33: lost folder-scope authority fails closed',async()=>{
 anchorVisible=false;const res=reply();
 const result=await selectCollection({params:{collectionId:'col'},body:{expectedCollectionRevision:scopeRevision}},res);
 assert.equal(result,undefined);assert.equal(res.status,403);assert.equal(res.payload.code,'LIBRARY_COLLECTION_FOLDER_DENIED');anchorVisible=true;
});
console.log(`PASS ${total}/${total} Library completion checks including R33 selection`);

await test('R33: collections above the 200-item limit fail atomically',async()=>{
 collectionKind='manual';
 const additions=Array.from({length:201},(_,index)=>({id:`bulk-${index}`,parentId:'any',type:'file',title:'Bulk record',status:'active',lifecycleState:'active',revision:1,metadata:'{}'}));
 files.push(...additions);
 const res=reply();const result=await selectCollection({params:{collectionId:'col'},body:{expectedCollectionRevision:scopeRevision}},res);
 assert.equal(res.status,409);assert.equal(result.code,'LIBRARY_MATCHING_TOO_LARGE');
 files.splice(files.length-additions.length);collectionKind='smart';
});
await test('R33: authorization is revalidated inside the selection snapshot',async()=>{
 currentActor='reader';const before=shareRoles.reader;
 // The preflight sees a granted reader; the transactional re-read observes revocation.
 const original=db.libraryCollection.findUnique;
 let looked=0;
 db.libraryCollection.findUnique=async (...args)=>{
  looked++;const result=await original(...args);
  if(looked>=2)return {...result,grants:[]};
  return result;
 };
 const res=reply();
 try {
  const result=await selectCollection({params:{collectionId:'col'},body:{expectedCollectionRevision:scopeRevision}},res);
  assert.equal(result.code,'LIBRARY_COLLECTION_ACCESS_DENIED');assert.equal(res.status,403);
  assert.equal(before,'viewer');
 } finally {db.libraryCollection.findUnique=original;currentActor='owner';}
});
await test('R33: route never serializes protected source records or grants new access',async()=>{
 const code=routes.slice(routes.indexOf('app.post("/api/library/collections/:collectionId/select-matching"'),routes.indexOf('app.post("/api/library/collections/:collectionId/items"'));
 assert.match(code,/tx\.personnelRecordAttachment\.findMany/);
 assert.match(code,/libraryAccess\.visibleFor\(context, item, "view"\)/);
 assert.match(code,/collectLibraryMatchingSelection\(/);
 assert.match(code,/isolationLevel: "RepeatableRead"/);
 assert.doesNotMatch(code,/libraryCollectionGrant\.(upsert|create|update)/);
 assert.doesNotMatch(code,/tx\.libraryItem\.(update|create|delete)/);
 assert.match(ui,/api\/library\/collections\/\$\{encodeURIComponent\(collectionAtStart\.id\)\}\/select-matching/);
 assert.match(ui,/expectedCollectionRevision: collectionAtStart\.revision/);
});
console.log(`PASS ${total}/${total} Library collection selection source and runtime checks`);
