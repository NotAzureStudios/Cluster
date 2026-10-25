import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
function load(filename,deps={},extra={}){
  const code=ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:(id)=>{if(Object.hasOwn(deps,id))return deps[id];throw Error('unmocked dependency '+id)},Promise,URL,URLSearchParams,Date,JSON,Set,Map,Object,console,...extra},{filename});
  return module.exports;
}
const fakeNode=new Proxy({}, {get:(target,key)=>key==='parse'?input=>input:()=>fakeNode});
const z=new Proxy({object:()=>fakeNode,string:()=>fakeNode,enum:()=>fakeNode,number:()=>fakeNode,boolean:()=>fakeNode,array:()=>fakeNode,union:()=>fakeNode,coerce:{number:()=>fakeNode}}, {get:(t,k)=>t[k]??fakeNode});
const routes=load('apps/server/src/domains/source-control/source-control-routes.ts',{
  zod:{z},
  '../../core/http-errors.js':{createHttpError:(code,message,status)=>Object.assign(new Error(message),{code,status})},
  '../integrations/external-entity-link-service.js':{createExternalEntityLinkService:()=>({})},
  '../../core/http-cache.js':{sendPrivateRevalidated:(_req,_reply,payload)=>payload},
  '../access/authorization.js':{AUTHORIZATION_RULE_SELECT:{id:true}},
});
const handlers=new Map();
let tool=true, signedIn=true, permitted=['P1'];
let linked=['P1'];
let repoArchived=false, primary='R1';
let commits=[{id:'C1',revision:'abcdef0123456789abcdef0123456789abcdef01'}];
let directRecord={...commits[0],shortRevision:'abcdef0',message:'Linkable older commit',authorName:'Dev',committedAt:new Date(),webUrl:null,additions:5,deletions:1,filesChanged:2};
let seenRules=[];
const makeProject=id=>({id,name:id,source:'manual',memberships:[],sourceBindings:[{repositoryId:primary}]});
let reviewRecord={id:'V1',projectId:'P1',repositoryId:'R1',title:'Older source review',status:'merged',sourceRevision:'abcdef0123',targetRevision:'abcdef0123'};
const deps={
 app:{get:(p,fn)=>handlers.set('GET '+p,fn),post:()=>{},patch:()=>{},delete:()=>{}},
 sourceControl:{reviewForProject:async(projectId,repositoryId,reviewId)=>reviewRecord&&reviewRecord.id===reviewId&&reviewRecord.projectId===projectId&&reviewRecord.repositoryId===repositoryId?reviewRecord:null},
 prisma:{
  projectSourceBinding:{findMany:async(q)=>repoArchived?[]:linked.map(id=>({projectId:id,project:makeProject(id)}))},
  accessRule:{findMany:async(q)=>{seenRules=q.where.targetId.in;return []}},
  sourceCommit:{findMany:async(q)=>commits.filter(c=>c.revision.toLowerCase().startsWith(q.where.revision.startsWith)).slice(0,q.take),findFirst:async(q)=> q.where.id===directRecord?.id&&q.where.repositoryId==='R1'?directRecord:null},
  project:{findUnique:async(q)=>({id:q.where.id,sourceBindings:[{repositoryId:primary}]})},
 },
 authorization:{
  requireTool:async()=>tool?{id:'viewer'}:null,
  identityForRequest:async()=>signedIn?{user:{id:'U1'},decorated:{},role:'member'}:{user:null,decorated:null,role:null},
  authorize:async(_identity,_action,target)=>({allowed:permitted.includes(target.project.id)}),
 },
 enforceTargetAccess:async()=>true,
};
routes.registerSourceControlRoutes(deps);
const lookup=handlers.get('GET /api/source-control/resolve-commit');
const detail=handlers.get('GET /api/projects/:projectId/source-control/commits/:commitId');
const reviewDetail=handlers.get('GET /api/projects/:projectId/source-control/reviews/:reviewId');
assert.equal(typeof lookup,'function');assert.equal(typeof detail,'function');assert.equal(typeof reviewDetail,'function');
const reply={code(){return this},send(v){return v}};
const query={repositoryId:'R1',revision:'abcdef0'};
const invoke=()=>lookup({query},reply);
const detailInvoke=(projectId='P1',commitId='C1')=>detail({params:{projectId,commitId}},reply);
const reviewInvoke=(projectId='P1',reviewId='V1')=>reviewDetail({params:{projectId,reviewId}},reply);
let count=0;async function check(label,fn){try{await fn();count++;console.log('PASS',label)}catch(e){process.exitCode=1;console.error('FAIL',label,e)}}
async function throwsCode(action,code){await assert.rejects(action,e=>e.code===code)}
await check('auth-bounded resolver returns the exact commit ID and Project, no source content',async()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(await invoke())),{ok:true,projectId:'P1',repositoryId:'R1',commitId:'C1',revision:commits[0].revision});
  assert.deepEqual(seenRules,['P1']);
});
await check('no authorized Project returns indistinguishable 404 rather than a revision hint',async()=>{
  permitted=[];await throwsCode(invoke,'SOURCE_COMMIT_NOT_FOUND');permitted=['P1'];
});
await check('linked but secondary repository never opens unrelated primary source panel',async()=>{
  primary='R2';await throwsCode(invoke,'SOURCE_COMMIT_NOT_FOUND');primary='R1';
});
await check('revoked or archived repo cannot resolve',async()=>{
  repoArchived=true;await throwsCode(invoke,'SOURCE_COMMIT_NOT_FOUND');repoArchived=false;
});
await check('missing revision is hidden behind the same 404',async()=>{
  commits=[];await throwsCode(invoke,'SOURCE_COMMIT_NOT_FOUND');commits=[directRecord];
});
await check('abbreviated revision collisions refuse ambiguous navigation',async()=>{
  commits=[directRecord,{id:'C2',revision:'abcdef0999999999999999999999999999999999'}];await throwsCode(invoke,'SOURCE_COMMIT_AMBIGUOUS');commits=[directRecord];
});
await check('two visible Project placements refuse ambiguous navigation',async()=>{
  linked=['P1','P2'];permitted=['P1','P2'];await throwsCode(invoke,'SOURCE_COMMIT_PROJECT_AMBIGUOUS');linked=['P1'];permitted=['P1'];
});
await check('viewer with access to only one of two projects resolves only authorized Project',async()=>{
  linked=['P1','P2'];permitted=['P2'];assert.equal((await invoke()).projectId,'P2');linked=['P1'];permitted=['P1'];
});
await check('sourceControl disabled blocks resolving and detail hydration',async()=>{
  tool=false;assert.equal(await invoke(),undefined);assert.equal(await detailInvoke(),undefined);tool=true;
});
await check('unauthenticated lookup fails closed',async()=>{
  signedIn=false;await throwsCode(invoke,'AUTH_REQUIRED');signedIn=true;
});
await check('older canonical ID hydrates only from the bound primary repository',async()=>{
  const result=await detailInvoke();assert.equal(result.commit.id,'C1');assert.equal(result.commit.message,'Linkable older commit');primary='R2';await throwsCode(detailInvoke.bind(null,'P1','C1'),'SOURCE_COMMIT_NOT_FOUND');primary='R1';
});
await check('unknown commit ID cannot leak a repository record',async()=>{
  await throwsCode(()=>detailInvoke('P1','unauthorized'),'SOURCE_COMMIT_NOT_FOUND');
});
await check('older source review hydrates from the same authorized Project and repository',async()=>{
  assert.equal((await reviewInvoke()).review.title,'Older source review');
  primary='R2';await throwsCode(reviewInvoke,'SOURCE_REVIEW_NOT_FOUND');primary='R1';
});
await check('source review rejects unknown and wrong-Project IDs without detail leakage',async()=>{
  await throwsCode(()=>reviewInvoke('P1','other'),'SOURCE_REVIEW_NOT_FOUND');
  await throwsCode(()=>reviewInvoke('P2','V1'),'SOURCE_REVIEW_NOT_FOUND');
});
await check('source-review hydration also honors tool-disabled state',async()=>{
  tool=false;assert.equal(await reviewInvoke(),undefined);tool=true;
});
await check('legacy commit resolution and canonical review hydration do not bypass authorization',async()=>{
  permitted=[];await throwsCode(invoke,'SOURCE_COMMIT_NOT_FOUND');
  // Project endpoint authorization is enforced by shared projectSourceContext
  // before it reaches the specialized source-control service.
  const server=fs.readFileSync(path.join(root,'apps/server/src/domains/source-control/source-control-routes.ts'),'utf8');
  assert.match(server,/projectSourceContext\(deps, request, reply, projectId, "view"\)/);
  assert.match(server,/reviewForProject\(projectId, context\.binding\.repositoryId, reviewId\)/);
  permitted=['P1'];
});
// Desktop deferred intent implementation is executed, not merely grep-checked.
const triggered=[];let now=1000;
const win={dispatchEvent:e=>triggered.push(e)};
const FakeEvent=class {constructor(type,{detail}={}){this.type=type;this.detail=detail}};
const work=load('packages/renderer/src/features/workflow/work-navigation.ts',{}, {window:win,CustomEvent:FakeEvent,Date:{now:()=>now}});
await check('legacy revision link queues a credential-free, replaceable intent for authenticated resolution',async()=>{
  const first={repositoryId:'R1',revision:'abcdef0'};
  work.queueDesktopSourceCommit(first);
  assert.equal(work.readPendingDesktopSourceCommit(),first);
  assert.equal(triggered.at(-1).type,'cluster:desktop-source-commit');
  const second={repositoryId:'R2',revision:'0123456'};
  work.queueDesktopSourceCommit(second);
  work.clearPendingDesktopSourceCommit(first);
  assert.equal(work.readPendingDesktopSourceCommit(),second);
  work.clearPendingDesktopSourceCommit(second);
  assert.equal(work.readPendingDesktopSourceCommit(),null);
  work.queueDesktopSourceCommit(first);now+=120001;
  assert.equal(work.readPendingDesktopSourceCommit(),null);
  work.queueDesktopSourceCommit(first);
  work.queueDesktopWorkNavigation({screen:'people',inspectId:'U2'});
  assert.equal(work.readPendingDesktopSourceCommit(),null,'newer ordinary deep link must win');
  work.queueDesktopSourceCommit(second);
  assert.equal(work.readPendingDesktopWorkNavigation(),null,'newer source link must win');
});
await check('Project commit inspector extracts exact scope without confusing review context',async()=>{
  const nav=load('packages/renderer/src/features/projects/source-review-navigation.ts');
  assert.equal(nav.readFocusedSourceCommit('?inspect=source-commit%3AC1'),'C1');
  assert.equal(nav.readFocusedSourceCommit('?inspect=source-review%3AR1'),null);
});
await check('authoritative integration and protected deep-link dispatch wired across server and renderer',async()=>{
  const desktop=fs.readFileSync(path.join(root,'packages/renderer/src/core/desktop.ts'),'utf8');
  const application=fs.readFileSync(path.join(root,'packages/renderer/src/features/application/ClusterApplication.tsx'),'utf8');
  const panel=fs.readFileSync(path.join(root,'packages/renderer/src/features/projects/ProjectChangesPanel.tsx'),'utf8');
  assert.match(desktop,/special\?\.type === "source_commit"/);
  assert.match(desktop,/queueDesktopSourceCommit\(/);
  assert.match(application,/CLUSTER_DESKTOP_SOURCE_COMMIT_EVENT/);
  assert.match(application,/readPendingDesktopSourceCommit\(\) !== intent/);
  assert.match(application,/canUseProject\(activeUser, project\)/);
  assert.match(application,/source-commit", inspectId: resolved\.commitId/);
  assert.match(panel,/source-control\/commits\/\$\{encodeURIComponent\(focusedCommitId\)\}/);
  assert.match(panel,/cluster-source-commit-\$\{commit\.id\}/);
});
console.log(`${count}/19 TD4 R58 source-review/commit authorization, resolution and navigation checks passed`);
if(count!==19)process.exitCode=1;
