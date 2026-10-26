#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const text=readFileSync('apps/server/src/domains/boards/board-routes.ts','utf8');
const js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
let access=true, actor='U1', lastAccess=null, listReads=0, reversals=0;const events=[],broadcasts=[];const endpoints=new Map();
const app={log:{info:()=>{}},get:(url,handler)=>endpoints.set(`GET ${url}`,handler),post:(url,handler)=>endpoints.set(`POST ${url}`,handler),patch:(url,handler)=>endpoints.set(`PATCH ${url}`,handler),delete:(url,handler)=>endpoints.set(`DELETE ${url}`,handler)};
const repository={findUpdatedList:async()=>({id:'L1',title:'Ideas',boardId:'B1',board:{projectId:'P1'}})};
const history={BoardListHistoryError:class BoardListHistoryError extends Error{},listBoardListSavedHistory:async(_db,id,user)=>{listReads++;assert.equal(id,'L1');return {currentRevision:8,canUndo:user==='U1',canRedo:false,operations:[{id:'OP1',action:'update'}]}},reverseListSavedOperation:async(_db,input)=>{reversals++;assert.equal(input.expectedRevision,8);assert.equal(input.operationId,'OP1');return {listId:'L1',boardId:'B1',revision:9,changedFields:['title'],action:input.action}}};
const schemas=new Proxy({},{get:()=>({parse:value=>value})});
const z={object:()=>({parse:value=>value}),number:()=>({int:()=>({positive:()=>true})}),string:()=>({min:()=>({max:()=>true})})};
const mockImports={
 './board-policy.js':{createBoardPolicy:()=>({requireList:async(_request,_reply,id,kind)=>{lastAccess={id,kind};return access;},requireBoard:()=>access,requireProjectBoardManage:()=>access})},
 './board-repository.js':{createBoardRepository:()=>repository},
 './board-service.js':{createBoardService:()=>({})},
 '../integrations/external-entity-link-service.js':{createExternalEntityLinkService:()=>({})},
 './board-planning-service.js':{buildBoardPlanningPayload:()=>({}),findBoardProjectionCards:async()=>[],findBoardProjectionRelationships:async()=>[]},
 './board-schemas.js':schemas,
 './board-list-saved-history.js':history,
 './board-list-lifecycle.js':{BoardListLifecycleError:class BoardListLifecycleError extends Error{},transitionBoardListLifecycle:async()=>({})},
 'zod':{z},
};
const mod={exports:{}};
vm.runInNewContext(js,{module:mod,exports:mod.exports,require:(id)=>{if(!(id in mockImports)) throw Error(`missing ${id}`);return mockImports[id];},Date,JSON,Error,Set,Map},{filename:'board-routes.ts'});
mod.exports.registerBoardRoutes({app,prisma:{},authorization:{},getCurrentUser:async()=>actor ? {id:actor}:null,defaultBoardColumnsForProjectType:()=>[],logActivity:async event=>events.push(event),sendRevisionConflict:()=>{},serializeBoard:x=>x,serializeCard:x=>x,collaborationRuntime:{scheduleBroadcast:(...args)=>broadcasts.push(args)}});
const reply=()=>({status:200,headers:{},code(code){this.status=code;return this;},header(key,value){this.headers[key]=value;return this;},send(obj){this.result=obj;return this;}});
const req=(body)=>({params:{listId:'L1'},body});
let passed=0;async function test(title,fn){await fn();passed++;console.log('PASS '+title)}
await test('history endpoints are registered under the canonical List routes',()=>{
 for(const method of ['GET /api/lists/:listId/saved-history','POST /api/lists/:listId/saved-history/undo','POST /api/lists/:listId/saved-history/redo']) assert.equal(typeof endpoints.get(method),'function');
});
await test('read requires view authorization before loading author/history',async()=>{
 access=false;const n=listReads;await endpoints.get('GET /api/lists/:listId/saved-history')(req(),reply());assert.equal(listReads,n);assert.equal(lastAccess.kind,'view');access=true;
});
await test('authorized history read is explicitly non-cacheable',async()=>{
 const r=reply();const data=await endpoints.get('GET /api/lists/:listId/saved-history')(req(),r);assert.equal(data.currentRevision,8);assert.equal(r.headers['Cache-Control'],'private, no-store');
});
await test('Undo requires manage permission and does not bypass it',async()=>{
 access=false;const n=reversals;await endpoints.get('POST /api/lists/:listId/saved-history/undo')(req({expectedRevision:8,operationId:'OP1'}),reply());assert.equal(reversals,n);assert.equal(lastAccess.kind,'manage');access=true;
});
await test('unauthenticated sessions cannot reverse a List',async()=>{
 actor=null;const n=reversals;const r=reply();await endpoints.get('POST /api/lists/:listId/saved-history/undo')(req({expectedRevision:8,operationId:'OP1'}),r);assert.equal(reversals,n);assert.equal(r.status,401);actor='U1';
});
await test('Undo records source operation identity and refreshes Board',async()=>{
 const response=await endpoints.get('POST /api/lists/:listId/saved-history/undo')(req({expectedRevision:8,operationId:'OP1'}),reply());
 assert.equal(response.ok,true);assert.equal(response.revision,9);assert.equal(events.at(-1).metadata.sourceOperationId,'OP1');assert.equal(broadcasts.at(-1)[0],'board');
});
await test('Redo uses the same revision-managed authority',async()=>{
 const response=await endpoints.get('POST /api/lists/:listId/saved-history/redo')(req({expectedRevision:8,operationId:'OP1'}),reply());assert.equal(response.action,'redo');assert.equal(reversals,2);
});
console.log(`G25 WS15 Board List route tests ${passed}/${passed} passed`);
