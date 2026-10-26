#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
function transpile(file,imports){const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;const m={exports:{}};vm.runInNewContext(code,{module:m,exports:m.exports,require:id=>imports[id]??require(id),Date,JSON,Error,Map,Set,Array},{filename:file});return m.exports;}
const lifecycle=transpile('apps/server/src/domains/boards/board-list-lifecycle.ts',{});
let access=true,actor='U1',boardAccess=true,forceError=null,mutations=0,reads=0,activity=[],broadcast=[],deleted=0;
const routes=new Map();const app={log:{info:()=>{}},get:(path,fn)=>routes.set('GET '+path,fn),post:(path,fn)=>routes.set('POST '+path,fn),patch:(path,fn)=>routes.set('PATCH '+path,fn),delete:(path,fn)=>routes.set('DELETE '+path,fn)};
const row={id:'L1',title:'Review',boardId:'B1',revision:9,archived:false};
const repository={findBoardForMutation:async()=>({id:'B1',projectId:'P1',project:{id:'P1'}}),findArchivedLists:async()=>{reads++;return [{id:'LA',boardId:'B1',title:'Archive',revision:3,archived:true}]},findListForMutation:async()=>({...row,board:{projectId:'P1'}}),findListForDelete:async()=>({...row,cards:[],board:{projectId:'P1'}})};
const service={removeList:async()=>{deleted++;return {ok:true}}};
const schemas=new Proxy({},{get:()=>({parse:v=>v})});
const z={object:()=>({parse:v=>v}),enum:()=>({}),number:()=>({int:()=>({positive:()=>({})})}),string:()=>({min:()=>({max:()=>({})})})};
const mocks={
 './board-policy.js':{createBoardPolicy:()=>({requireList:async()=>access,requireBoard:async()=>boardAccess,requireProjectBoardManage:async()=>access})},
 './board-repository.js':{createBoardRepository:()=>repository},'./board-service.js':{createBoardService:()=>service},
 './board-list-lifecycle.js':{BoardListLifecycleError:lifecycle.BoardListLifecycleError,transitionBoardListLifecycle:async(_db,input)=>{mutations++;if(forceError)throw forceError;return {...row,archived:input.action==='archive',revision:input.expectedRevision+1}}},
 './board-list-saved-history.js':{BoardListHistoryError:class BoardListHistoryError extends Error{},listBoardListSavedHistory:async()=>({}),reverseListSavedOperation:async()=>({})},
 '../integrations/external-entity-link-service.js':{createExternalEntityLinkService:()=>({})},
 './board-planning-service.js':{buildBoardPlanningPayload:()=>({}),findBoardProjectionCards:async()=>[],findBoardProjectionRelationships:async()=>[]},
 './board-schemas.js':schemas,'zod':{z},
};
transpile('apps/server/src/domains/boards/board-routes.ts',mocks).registerBoardRoutes({app,prisma:{},authorization:{},getCurrentUser:async()=>actor?{id:actor}:null,defaultBoardColumnsForProjectType:()=>[],logActivity:async ev=>{activity.push(ev)},sendRevisionConflict:()=>{},serializeBoard:x=>x,serializeCard:x=>x,collaborationRuntime:{scheduleBroadcast:(...args)=>broadcast.push(args)}});
const reply=()=>({status:200,headers:{},code(n){this.status=n;return this},header(k,v){this.headers[k]=v;return this},send(body){this.body=body;return this}});
const req=(body,params={listId:'L1',boardId:'B1'})=>({params,body});const run=async(k,body,r=reply())=>({data:await routes.get(k)(req(body),r),reply:r});
let passed=0;async function test(label,fn){await fn();console.log('PASS '+label);passed++;}
await test('archive and restore routes are registered under canonical List',()=>{assert.equal(typeof routes.get('POST /api/lists/:listId/lifecycle'),'function');assert.equal(typeof routes.get('GET /api/boards/:boardId/archived-lists'),'function');});
await test('unauthorized archive cannot reach transaction',async()=>{access=false;const n=mutations;await run('POST /api/lists/:listId/lifecycle',{action:'archive',expectedRevision:9});assert.equal(mutations,n);access=true;});
await test('archive carries actor identity and expected revision',async()=>{const r=await run('POST /api/lists/:listId/lifecycle',{action:'archive',expectedRevision:9});assert.equal(r.data.list.archived,true);assert.equal(r.data.list.revision,10);assert.equal(broadcast.at(-1)[0],'board');assert.equal(activity.at(-1).entityType,'list');});
await test('restore uses identical permission-protected path',async()=>{const r=await run('POST /api/lists/:listId/lifecycle',{action:'restore',expectedRevision:9});assert.equal(r.data.list.archived,false);assert.match(activity.at(-1).title,/restored/i);});
await test('revision mismatch returns 409 and does not broadcast',async()=>{forceError=new lifecycle.BoardListLifecycleError('LIST_REVISION_CONFLICT','Stale');const n=broadcast.length;const r=await run('POST /api/lists/:listId/lifecycle',{action:'archive',expectedRevision:1});assert.equal(r.reply.status,409);assert.equal(r.reply.body.code,'LIST_REVISION_CONFLICT');assert.equal(broadcast.length,n);forceError=null;});
await test('active Ticket guard returns explanatory 409',async()=>{forceError=new lifecycle.BoardListLifecycleError('LIST_HAS_ACTIVE_WORK','Move Tickets');const r=await run('POST /api/lists/:listId/lifecycle',{action:'archive',expectedRevision:9});assert.equal(r.reply.status,409);assert.equal(r.reply.body.code,'LIST_HAS_ACTIVE_WORK');forceError=null;});
await test('unauthorized archive listing cannot read column names',async()=>{boardAccess=false;const n=reads;await run('GET /api/boards/:boardId/archived-lists');assert.equal(reads,n);boardAccess=true;});
await test('archive listing includes metadata but no private Card counts',async()=>{const r=await run('GET /api/boards/:boardId/archived-lists');assert.equal(r.reply.headers['Cache-Control'],'private, no-store');assert.equal(r.data[0].title,'Archive');assert.equal('_count' in r.data[0],false);});
await test('permanent deletion remains permission protected',async()=>{access=false;const n=deleted;await run('DELETE /api/lists/:listId',{expectedRevision:9});assert.equal(deleted,n);access=true;});
await test('permanent deletion maps dependency block to 409',async()=>{service.removeList=async()=>{throw new lifecycle.BoardListLifecycleError('LIST_DELETE_BLOCKED','Column contains historical work')};const r=await run('DELETE /api/lists/:listId',{expectedRevision:9});assert.equal(r.reply.status,409);assert.equal(r.reply.body.code,'LIST_DELETE_BLOCKED');});
console.log(`G25 WS16 routes ${passed}/${passed} passed`);
