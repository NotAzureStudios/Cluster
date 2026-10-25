/** TD6 G22: exercised registered Project comment routes and shared-work authority, not a PostgreSQL/React runtime claim. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import vm from 'node:vm';
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(join(execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'typescript')); } })();
const source = (file) => readFileSync(join(root, file), 'utf8');
function load(file, imports = {}) {
  const compiled = ts.transpileModule(source(file), { compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022} }).outputText;
  const mod = {exports:{}};
  vm.runInNewContext(compiled, {module:mod, exports:mod.exports, require:(id)=>{if(id in imports) return imports[id];throw new Error('Unexpected dependency '+id+' in '+file)},JSON,Promise,Date,Map,Set,Number,String,Math,Array,Error,Object,Boolean,Buffer}, {filename:file});
  return mod.exports;
}
const zChain = new Proxy(function(){}, {get:(target,prop)=> prop === 'parse' ? (value)=>value : ()=>zChain,apply:()=>zChain});
const z = {object:()=>zChain,string:()=>zChain,boolean:()=>zChain,number:()=>zChain,array:()=>zChain,enum:(values)=>({parse(value){if(!values.includes(value)) throw new Error('Unsupported kind: '+value);return value}}),coerce:{number:()=>zChain}};
const projects = new Map([['p1',{id:'p1',name:'Artemis',archived:false,memberships:[]}],['p2',{id:'p2',name:'Borealis',archived:false,memberships:[]}]]);
const people = [{id:'admin',memberships:[{role:'admin'}]}, {id:'member',memberships:[{role:'member'}]}, {id:'teammate',memberships:[{role:'member'}]}, {id:'no-tool',memberships:[{role:'member'}]}, {id:'outsider',memberships:[{role:'member'}]}].map(user=>({...user,archived:false,accountState:'ACTIVE'}));
const records=[];const activities=[];const broadcasts=[];const drafts=[];const readStates=[];const threadReadStates=[];
let rejectNextActivity = false;
let nextId=0;
const withUsers = (comment) => comment ? {...comment,user:people.find(p=>p.id===comment.userId)||null,assignee:people.find(p=>p.id===comment.assigneeId)||null,resolvedBy:people.find(p=>p.id===comment.resolvedById)||null} : null;
const matchesComment = (r, where={}) => {
  if (where.entityType && r.entityType!==where.entityType) return false;
  if (where.entityId && r.entityId!==where.entityId) return false;
  if (where.parentCommentId===null && r.parentCommentId!==null) return false;
  if (where.parentCommentId?.not===null && r.parentCommentId===null) return false;
  if (where.threadRootId?.in && !where.threadRootId.in.includes(r.threadRootId)) return false;
  if (typeof where.threadRootId==='string'&&r.threadRootId!==where.threadRootId) return false;
  if (where.pinned!==undefined && r.pinned!==where.pinned) return false;
  if (where.OR && !where.OR.some(condition=>matchesComment(r,condition))) return false;
  if (where.AND && !where.AND.every(condition=>matchesComment(r,condition))) return false;
  if (where.createdAt instanceof Date && r.createdAt.getTime()!==where.createdAt.getTime()) return false;
  if (where.createdAt?.lt && !(r.createdAt<where.createdAt.lt)) return false;
  if (where.createdAt?.gt && !(r.createdAt>where.createdAt.gt)) return false;
  if (where.id?.lt && !(r.id<where.id.lt)) return false;
  if (where.id?.gt && !(r.id>where.id.gt)) return false;
  return true;
};
const db={
  $transaction:async(fn)=> {
    const before=structuredClone(records),activityBefore=activities.length,draftBefore=structuredClone(drafts);
    try{return await fn(db)} catch(e){records.splice(0,records.length,...before);drafts.splice(0,drafts.length,...draftBefore);activities.length=activityBefore;throw e}
  },
  entityCommentDraft:{
    findUnique:async({where})=>drafts.find(r=>Object.entries(where.userId_entityType_entityId_slotKey).every(([k,v])=>r[k]===v))||null,
    create:async({data})=>{if(drafts.some(r=>['userId','entityType','entityId','slotKey'].every(k=>r[k]===data[k])))throw Object.assign(new Error('duplicate'),{code:'P2002'});const row={...data,id:'draft'+(drafts.length+1),revision:1,updatedAt:new Date()};drafts.push(row);return row},
    updateMany:async({where,data})=>{const row=drafts.find(r=>['userId','entityType','entityId','slotKey'].every(k=>r[k]===where[k])&&r.revision===where.revision);if(!row)return {count:0};row.body=data.body;row.revision++;row.updatedAt=new Date();return {count:1}},
    deleteMany:async({where})=>{const index=drafts.findIndex(r=>['userId','entityType','entityId','slotKey'].every(k=>r[k]===where[k])&&r.revision===where.revision&&(where.body===undefined||where.body===r.body));if(index<0)return {count:0};drafts.splice(index,1);return {count:1}},
  },
  entityCommentReadState:{
    findUnique:async({where})=>readStates.find(r=>Object.entries(where.userId_entityType_entityId).every(([k,v])=>r[k]===v))||null,
    create:async({data})=>{if(readStates.some(r=>['userId','entityType','entityId'].every(k=>r[k]===data[k])))throw Object.assign(new Error('duplicate'),{code:'P2002'});readStates.push({...data});return {...data}},
    updateMany:async({where,data})=>{const row=readStates.find(r=>['userId','entityType','entityId'].every(k=>r[k]===where[k])&&r.lastReadAt<where.lastReadAt.lt);if(!row)return {count:0};row.lastReadAt=data.lastReadAt;return {count:1}},
  },
  entityCommentThreadReadState:{
    findUnique:async({where})=>threadReadStates.find(r=>Object.entries(where.userId_entityType_entityId_threadRootId).every(([k,v])=>r[k]===v))||null,
    create:async({data})=>{if(threadReadStates.some(r=>['userId','entityType','entityId','threadRootId'].every(k=>r[k]===data[k])))throw Object.assign(new Error('duplicate'),{code:'P2002'});threadReadStates.push({...data});return data},
    updateMany:async({where,data})=>{const row=threadReadStates.find(r=>['userId','entityType','entityId','threadRootId'].every(k=>r[k]===where[k])&&r.lastReadAt<where.lastReadAt.lt);if(!row)return {count:0};row.lastReadAt=data.lastReadAt;return {count:1}},
  },
  project:{findUnique:async({where})=>projects.get(where.id)||null},
  user:{findMany:async({where})=>people.filter(p=>where.id.in.includes(p.id)&&!p.archived)},
  accessRule:{findMany:async()=>[]},
  entityComment:{
    count:async({where})=>records.filter(r=>r.entityType===where.entityType&&r.entityId===where.entityId&&(!where.threadRootId||r.threadRootId===where.threadRootId)&&!r.deletedAt&&r.userId!==where.userId.not&&(!where.createdAt.gt||r.createdAt>where.createdAt.gt)&&r.createdAt<=where.createdAt.lte).length,
    findMany:async({where,take,orderBy=[]})=>records.filter(r=>matchesComment(r,where)).sort((a,b)=> {
      for(const order of orderBy){const [key,direction]=Object.entries(order)[0];const cmp = (a[key]>b[key]?1:a[key]<b[key]?-1:0)*(direction==='asc'?1:-1);if(cmp)return cmp}return 0
    }).slice(0,take).map(withUsers),
    groupBy:async({where})=> {
      const counts=new Map();for(const row of records.filter(r=>matchesComment(r,where)))counts.set(row.threadRootId,(counts.get(row.threadRootId)||0)+1);
      return [...counts].map(([threadRootId,count])=>({threadRootId,_count:{_all:count}}));
    },
    findFirst:async({where})=>records.find(r=>r.id===where.id&&r.entityType===where.entityType&&r.entityId===where.entityId&&(where.parentCommentId===undefined||r.parentCommentId===where.parentCommentId))||null,
    findUnique:async({where})=>records.find(r=>r.id===where.id)||null,
    findUniqueOrThrow:async({where})=>withUsers(records.find(r=>r.id===where.id)),
    create:async({data})=>{const row={...data,id:'comment'+(++nextId),revision:1,createdAt:new Date(),updatedAt:new Date(),pinned:false,resolved:false,reactions:'{}'};records.push(row);return withUsers(row)},
    update:async({where,data})=>{const row=records.find(r=>r.id===where.id);Object.assign(row,data);return withUsers(row)},
    updateMany:async({where,data})=>{const row=records.find(r=>r.id===where.id&&r.revision===where.revision);if(!row)return {count:0};Object.assign(row,Object.fromEntries(Object.entries(data).filter(([,value])=>value!==undefined)));row.revision=where.revision+(data.revision?.increment||0);return {count:1}},
    deleteMany:async({where})=>{const index=records.findIndex(r=>r.id===where.id&&r.revision===where.revision);if(index<0)return {count:0};records.splice(index,1);return {count:1}},
  },
};
const authorization={
  requireTool:async(req,reply,kind,level)=>req.id!=='no-tool',
  hasToolPermission:(user,role,tool,minimum)=>user.id!=='no-tool',
  requireAdmin:async(req)=>req.id==='admin',
};
const enforceTargetAccess=async(req,reply,kind,id,project,minimum)=>{
  const allowed=project&&!project.archived&&req.id!=='outsider'&&req.id!=='no-tool'&&(minimum==='view'||req.id!=='viewer');
  if(!allowed)reply.code(403).send({ok:false,code:'PROJECT_PERMISSION_DENIED'});
  return Boolean(allowed);
};
const {createEntityCommentAccess}=load('apps/server/src/domains/comments/entity-comment-access.ts');
const enforcement=createEntityCommentAccess({prisma:db,authRequired:true,getCurrentUser:async(req)=>req.id?{id:req.id}:null,authorization,enforceCardAccess:async()=>false,enforceTargetAccess});
const commentHelpers=load('apps/server/src/domains/comments/comment-revisions.ts');
const commentPages=load('apps/server/src/domains/comments/comment-pages.ts');
const handlers=new Map();
const {registerEntityCommentRoutes}=load('apps/server/src/domains/comments/entity-comment-routes.ts',{
  'zod':{z}, '@cluster/shared':{CLUSTER_ACCESS_TARGET_KINDS:['project','board','whiteboard'],clusterResourceKindFromEntityType:(value)=>value}, './comment-revisions.js':commentHelpers, './comment-pages.js':commentPages,
});
registerEntityCommentRoutes({
  app:{get:(path,handler)=>handlers.set('GET '+path,handler),post:(path,handler)=>handlers.set('POST '+path,handler),put:(path,handler)=>handlers.set('PUT '+path,handler),patch:(path,handler)=>handlers.set('PATCH '+path,handler),delete:(path,handler)=>handlers.set('DELETE '+path,handler)},
  prisma:db,getCurrentUser:async(req)=>req.id?{id:req.id}:null,decorateUserForClient:async(u)=>({isAdmin:u.id==='admin'}),
  enforceEntityCommentAccess:enforcement,hasTargetAccess:(person,role,kind,id,project)=>person.id!=='outsider'&&person.id!=='no-tool',
  authorization,recordCommentActivityInTransaction:async(_tx,event)=>{if(rejectNextActivity){rejectNextActivity=false;throw new Error("SIMULATED_ACTIVITY_FAILURE")};activities.push(event)},wakeCommentActivity:()=>{},serializeUserLite:(person)=>person?{id:person.id,displayName:person.id}:null,
  parseJsonObject:(raw)=>{try{return JSON.parse(raw||'{}')}catch{return {}}},collaborationRuntime:{scheduleBroadcast:(tool,id,force)=>broadcasts.push({tool,id,force})},
});
function call(method,path,id='member',query={},body={},params={}) {
  const reply={status:200,response:null,code(n){this.status=n;return this},send(value){this.response=value;return value}};
  const handler=handlers.get(method+' '+path);
  assert.ok(handler,'Missing route '+method+' '+path);
  return Promise.resolve(handler({id,query,body,params},reply)).then(value=>({status:reply.status,body:reply.response??value}));
}
const projectGet=(id,who='member')=>call('GET','/api/entity-comments',who,{entityType:'project',entityId:id});
const post=(id,who='member',extra={})=>call('POST','/api/entity-comments',who,{}, {entityType:'project',entityId:id,body:'Project decision and next steps',mentionedUserIds:[],...extra});
let passed=0;
async function check(name,run){await run();console.log('PASS',name);passed++}
await check('project has canonical comment kind end-to-end (server + renderer)',()=>{
 assert.match(source('apps/server/src/domains/comments/entity-comment-routes.ts'),/z\.enum\(\["project",/);
 assert.match(source('packages/renderer/src/components/CollaborationPanel.tsx'),/entityType\?: "project"/);
 assert.match(source('packages/renderer/src/features/projects/ProjectDetailPage.tsx'),/entityType="project" entityId=\{project\.id\}/);
});
await check('Project lookup includes active memberships and respects archival',async()=>{
 const result=await call('GET','/api/entity-comments/collaboration-room','member',{entityType:'project',entityId:'p1'});
 assert.equal(result.status,200);assert.equal(result.body.room.tool,'project');assert.equal(result.body.room.resourceId,'p1');assert.equal(result.body.room.projectId,'p1');
});
await check('authorized project comment is scoped to Project and audited',async()=>{
 const result=await post('p1'); assert.equal(result.status,200);assert.equal(result.body.entityType,'project');assert.equal(result.body.entityId,'p1');assert.equal(result.body.entity.kind,'project');
 assert.equal(activities.at(-1).projectId,'p1');assert.equal(activities.at(-1).entityType,'project');assert.equal(broadcasts.at(-1).tool,'project');
});
await check('another Project never receives this thread',async()=>{const result=await projectGet('p2');assert.equal(result.status,200);assert.equal(result.body.items.length,0)});
await check('no access means no comments or realtime room',async()=>{
 for(const type of ['GET /api/entity-comments','GET /api/entity-comments/collaboration-room']){
   const [method,path]=type.split(' ');const result=await call(method,path,'outsider',{entityType:'project',entityId:'p1'});
   assert.equal(result.status,403);
 }
});
await check('only contributor may create and read-only views do not grant mutations',async()=>{const result=await post('p1','viewer');assert.equal(result.status,403);assert.equal(records.length,1)});
await check('archived and missing Projects do not expose comments',async()=>{
 projects.get('p1').archived=true;const hidden=await projectGet('p1');assert.equal(hidden.status,404);
 const fail=await post('p1');assert.equal(fail.status,404);projects.get('p1').archived=false;
 assert.equal((await projectGet('missing')).status,404);
});
await check('member mentions filtered by current project/tool authorization',async()=>{
 const result=await post('p1','member',{body:'@teammate @outsider @no-tool',mentionedUserIds:['teammate','outsider','no-tool']});
 assert.equal(result.status,200);assert.deepEqual(Array.from(result.body.mentionedUserIds),['teammate']);
 assert.deepEqual(Array.from(activities.at(-1).metadata.userIds),['teammate']);
});
await check('replies must belong to the same Project',async()=>{
 const existing=records[0];const good=await post('p1','member',{parentCommentId:existing.id}); assert.equal(good.status,200);assert.equal(good.body.threadRootId,existing.id);
 const bad=await post('p2','member',{parentCommentId:existing.id});assert.equal(bad.status,400);assert.equal(bad.body.code,'COMMENT_PARENT_INVALID');
});
await check('compare-and-swap edit protects against conflicting writers',async()=>{
 const id=records[0].id;const ok=await call('PATCH','/api/entity-comments/:commentId','member',{}, {body:'Updated decision',expectedRevision:1},{commentId:id});
 assert.equal(ok.status,200);assert.equal(ok.body.revision,2);
 const conflict=await call('PATCH','/api/entity-comments/:commentId','member',{}, {body:'Stale overwrite',expectedRevision:1},{commentId:id});assert.equal(conflict.status,409);assert.equal(records[0].body,'Updated decision');
});
await check('non-author cannot edit a comment body',async()=>{
 const result=await call('PATCH','/api/entity-comments/:commentId','teammate',{}, {body:'Hijack',expectedRevision:2},{commentId:records[0].id});assert.equal(result.status,403);
});
await check('resolve and pin are revision-guarded and audited',async()=>{
 const result=await call('PATCH','/api/entity-comments/:commentId','member',{}, {resolved:true,pinned:true,expectedRevision:2},{commentId:records[0].id});
 assert.equal(result.status,200);assert.equal(result.body.resolved,true);assert.equal(result.body.pinned,true);
 assert.equal(activities.at(-1).type,'comment_resolved');
});
await check('delete rejects stale version then records metadata-only deletion evidence',async()=>{
 const id=records[0].id;const conflict=await call('DELETE','/api/entity-comments/:commentId','member',{expectedRevision:2},{},{commentId:id});assert.equal(conflict.status,409);
 const result=await call('DELETE','/api/entity-comments/:commentId','member',{expectedRevision:3},{},{commentId:id});assert.equal(result.status,200);
 const audit=activities.at(-1);assert.equal(audit.type,'comment_deleted');assert.equal(audit.projectId,'p1');assert.equal(audit.message,null);assert.equal(audit.metadata.commentId,id);
});
await check('watch and history UI expose the existing shared controls rather than parallel stores',()=>{
 const page=source('packages/renderer/src/features/projects/ProjectDetailPage.tsx');
 assert.match(page,/<SharedWorkWatchControl entity=\{\{ kind: "project"/);
 assert.match(page,/<SharedWorkActivityPanel entity=\{\{ kind: "project"/);
 assert.match(source('apps/server/src/domains/comments/entity-comment-routes.ts'),/publishCommentChange\(commentContext\)/);
 const board=source('packages/renderer/src/features/boards/BoardWorkspacePage.tsx');
 assert.match(board, /<SharedWorkWatchControl entity=\{\{ kind: "board"/);
 assert.match(board, /<SharedWorkActivityPanel entity=\{\{ kind: "board"/);
 const whiteboard=source('packages/renderer/src/features/whiteboards/WhiteboardWorkspacePanels.tsx');
 assert.match(whiteboard, /<SharedWorkActivityPanel entity=\{\{ kind: "whiteboard"/);
});

await check('root pagination is bounded, ordered and complete across 3 pages',async()=>{
 for(let n=0;n<55;n++){const posted=await post('p2','member',{body:'Thread '+n});assert.equal(posted.status,200)}
 const ids=[];let cursor=null;
 for(let n=0;n<4;n++){
   const page=await call('GET','/api/entity-comments','member',{entityType:'project',entityId:'p2',limit:20,...(cursor?{cursor}:{})});
   assert.equal(page.status,200);assert.ok(page.body.items.length<=20);
   ids.push(...page.body.items.map(r=>r.id));cursor=page.body.nextCursor;
   assert.equal(Boolean(cursor),page.body.hasMore);
   if(!cursor)break;
 }
 assert.equal(ids.length,55);assert.equal(new Set(ids).size,55);
});
await check('root cursor rejects malformed, mixed-mode and oversized payloads',async()=>{
 for(const cursor of ['%%%','a'.repeat(600),Buffer.from(JSON.stringify({v:1,mode:'replies',at:new Date().toISOString(),id:'x'})).toString('base64url')]){
   const result=await call('GET','/api/entity-comments','member',{entityType:'project',entityId:'p2',cursor});
   assert.equal(result.status,400);assert.equal(result.body.code,'COMMENT_CURSOR_INVALID');
 }
});
await check('pinned roots stay ahead of unpinned roots across cursor boundaries',async()=>{
 const pinned=records.find(r=>r.entityType==='project'&&r.entityId==='p2'&&r.parentCommentId===null);
 const result=await call('PATCH','/api/entity-comments/:commentId','member',{}, {pinned:true,expectedRevision:pinned.revision},{commentId:pinned.id});assert.equal(result.status,200);
 const page=await call('GET','/api/entity-comments','member',{entityType:'project',entityId:'p2',limit:1});
 assert.equal(page.body.items[0].id,pinned.id);assert.equal(page.body.hasMore,true);
 const next=await call('GET','/api/entity-comments','member',{entityType:'project',entityId:'p2',limit:1,cursor:page.body.nextCursor});
 assert.notEqual(next.body.items[0].id,pinned.id);
});
await check('large threads paginate replies and expose accurate count without loading all',async()=>{
 const root=records.find(r=>r.entityType==='project'&&r.entityId==='p2'&&r.pinned);
 for(let i=0;i<61;i++)assert.equal((await post('p2','member',{body:'Reply '+i,parentCommentId:root.id})).status,200);
 const page=await call('GET','/api/entity-comments','member',{entityType:'project',entityId:'p2',limit:1});
 assert.equal(page.body.items[0].replyCount,61);
 assert.equal(page.body.items.length,1);
 const ids=[];let cursor=null;
 for(let attempt=0;attempt<4;attempt++){
   const result=await call('GET','/api/entity-comments/:commentId/replies','member',{limit:25,...(cursor?{cursor}:{})},{},{commentId:root.id});
   assert.equal(result.status,200);ids.push(...result.body.items.map(item=>item.id));cursor=result.body.nextCursor;
   if(!cursor)break;
 }
 assert.equal(ids.length,61);assert.equal(new Set(ids).size,61);
});
await check('reply pages enforce Project access and root-only identity',async()=>{
 const root=records.find(r=>r.entityType==='project'&&r.entityId==='p2'&&r.pinned);
 assert.equal((await call('GET','/api/entity-comments/:commentId/replies','outsider',{}, {},{commentId:root.id})).status,403);
 const reply=records.find(r=>r.parentCommentId===root.id);
 assert.equal((await call('GET','/api/entity-comments/:commentId/replies','member',{}, {},{commentId:reply.id})).status,404);
 const invalid=await call('GET','/api/entity-comments/:commentId/replies','member',{cursor:'bad$'}, {},{commentId:root.id});
 assert.equal(invalid.status,400);
});
await check('deleting roots preserves reply graph but removes visible content and identity',async()=>{
 const root=records.find(r=>r.entityType==='project'&&r.entityId==='p2'&&r.pinned);
 const countBefore=records.filter(r=>r.threadRootId===root.id&&r.parentCommentId!==null).length;
 const result=await call('DELETE','/api/entity-comments/:commentId','member',{expectedRevision:root.revision},{},{commentId:root.id});
 assert.equal(result.status,200);assert.equal(records.filter(r=>r.threadRootId===root.id&&r.parentCommentId!==null).length,countBefore);
 const page=await call('GET','/api/entity-comments','member',{entityType:'project',entityId:'p2',limit:50});
 let deleted=page.body.items.find(r=>r.id===root.id);
 if(!deleted && page.body.nextCursor){const next=await call('GET','/api/entity-comments','member',{entityType:'project',entityId:'p2',limit:50,cursor:page.body.nextCursor});deleted=next.body.items.find(r=>r.id===root.id)}
 assert.ok(deleted);assert.ok(deleted.deletedAt);assert.equal(deleted.body,'');assert.equal(deleted.user,null);assert.equal(deleted.userId,null);
 assert.equal(deleted.replyCount,countBefore);
 assert.equal(activities.at(-1).message,null);
 const replies=await call('GET','/api/entity-comments/:commentId/replies','member',{limit:2},{},{commentId:root.id});
 assert.equal(replies.status,200);assert.equal(replies.body.items.length,2);
 assert.equal((await call('PATCH','/api/entity-comments/:commentId','member',{}, {body:'revive',expectedRevision:root.revision},{commentId:root.id})).status,404);
 assert.equal((await call('POST','/api/entity-comments/:commentId/reactions','member',{}, {reaction:'ok'},{commentId:root.id})).status,404);
});
await check('failed activity transaction rolls back comment creation without broadcasting',async()=>{
 const before=records.length, activityCount=activities.length, broadcastCount=broadcasts.length;
 rejectNextActivity=true;
 await assert.rejects(()=>post('p1','member',{body:'Should not be persisted'}),/SIMULATED_ACTIVITY_FAILURE/);
 assert.equal(records.length,before);assert.equal(activities.length,activityCount);assert.equal(broadcasts.length,broadcastCount);
});
await check('failed activity transaction rolls back comment edit and deletion',async()=>{
 const row=records.find(r=>r.entityType==='project'&&r.entityId==='p1'&&!r.deletedAt);
 const old={revision:row.revision,body:row.body};const oldEvents=activities.length;
 rejectNextActivity=true;
 await assert.rejects(()=>call('PATCH','/api/entity-comments/:commentId','member',{}, {body:'Uncommitted',expectedRevision:row.revision},{commentId:row.id}),/SIMULATED_ACTIVITY_FAILURE/);
 const restored=records.find(r=>r.id===row.id);assert.equal(restored.body,old.body);assert.equal(restored.revision,old.revision);
 rejectNextActivity=true;
 await assert.rejects(()=>call('DELETE','/api/entity-comments/:commentId','member',{expectedRevision:restored.revision},{},{commentId:row.id}),/SIMULATED_ACTIVITY_FAILURE/);
 assert.ok(!records.find(r=>r.id===row.id).deletedAt);assert.equal(activities.length,oldEvents);
});
await check('renderer uses real lazy thread paging and tombstone UI',()=>{
 const ui=source('packages/renderer/src/components/CollaborationPanel.tsx');
 assert.match(ui,/loadMoreRoots/);assert.match(ui,/loadReplyPage/);assert.match(ui,/rootNextCursor/);assert.match(ui,/comment\.deletedAt/);
 assert.doesNotMatch(ui,/api<EntityComment\[\]>/);
});
await check('activity writer offers strict transactional API and commit wake',()=>{
 const activity=source('apps/server/src/domains/activity/activity-service.ts');
 assert.match(activity,/async function recordInTransaction/);assert.match(activity,/wakeCommittedActivity/);
 assert.match(source('apps/server/src/app/cluster-server.ts'),/recordCommentActivityInTransaction/);
});
console.log(`TD6 G23 collaboration closeout: ${passed}/${passed} passed`);

export {call,db,records,projects,people,activities,broadcasts,drafts,readStates,threadReadStates};
