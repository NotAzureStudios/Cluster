import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], {encoding: 'utf8'}).trim(), 'typescript/lib/typescript.js')); }})();
const src = file => readFileSync(file, 'utf8');
const load = (file, imports={}) => {
  const emitted=ts.transpileModule(src(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
  assert.equal(emitted.diagnostics?.length||0,0);
  const mod={exports:{}};
  vm.runInNewContext(emitted.outputText,{module:mod,exports:mod.exports,require(id){if(!(id in imports))throw Error(`Unexpected import ${id}`);return imports[id];},Date,Map,Set,Error,Boolean,Number,String,Array,Promise,Object,JSON,console},{filename:file});
  return mod.exports;
};
const index=load('apps/server/src/domains/search/search-index-builder.ts',{'@cluster/shared':{CLUSTER_WORKFLOW_RELATIONSHIP_META:{},clusterResourceAddressFromEntity:()=>null},'../workforce/workforce-user-authority.js':{workforceAuthorityProjection:()=>({skills:[]})}});
const {createSearchLiveAdmission}=load('apps/server/src/domains/search/search-live-admission.ts');
const T='2026-10-15T04:00:00.000Z', T2='2026-10-15T04:01:00.000Z';
const project=(id='p1')=>({id,name:`Project ${id}`,projectType:'General',updatedAt:T,createdAt:T,archived:false,status:'active', memberships:[],boards:[],controlRecords:[],whiteboards:[],libraryItems:[]});
const binding=(id='p1')=>({id:`binding-${id}`,projectId:id,repositoryId:'repo1',updatedAt:T});
const commit=(projectId='p1',extra={})=>({id:'commit1',projectId,repositoryId:'repo1',revision:'abcdefabcdefabcd',shortRevision:'abcdef',message:'Fix load race\nFull description',authorName:'Author',committedAt:T,updatedAt:T,createdAt:T,binding:binding(projectId),repository:{id:'repo1',name:'Shared Git',archived:false,updatedAt:T},...extra});
function corpus(rows=[commit()],projects=[project()]){return {projects,users:[],cards:[],timelineItems:[],calendarEvents:[],cardComments:[],activityEvents:[],projectFiles:[],videoAssets:[],deliveryRecords:[],sourceReviews:[],sourceCommits:rows,projectRelationships:[],packetDefinitions:[],studioPolicies:[],accessRules:[]};}
const hits=(rows=[commit()],projects=[project()])=>index.buildIndex(corpus(rows,projects)).items.filter(item=>item.kind==='source_commit');
let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS',name)};
await check('canonical resource points to real commit, not placement ID',()=>{const row=hits()[0];assert.equal(row.id,'p1:commit1');assert.equal(row.resource.kind,'source_commit');assert.equal(row.resource.id,'commit1');assert.equal(row.resource.projectId,'p1');assert.equal(row.projectUpdatedAt,T);});
await check('commit text, revision and author are searchable',()=>{const row=hits()[0];assert.match(row.normalizedText,/fix load race/);assert.match(row.normalizedText,/abcdefabcdefabcd/);assert.match(row.normalizedText,/author/);assert(!row.raw.authorEmail);});
await check('shared repository gets distinct Project placements',()=>{const rows=hits([commit('p1'),commit('p2')],[project('p1'),project('p2')]);assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);assert.equal(rows[0].resource.id,rows[1].resource.id);});
await check('removed and archived Projects do not generate commit results',()=>assert.equal(hits([commit('p2')]).length,0));
await check('archived repositories never generate results',()=>assert.equal(hits([commit('p1',{repository:{...commit().repository,archived:true}})]).length,0));
await check('unbound repository never produces Project result',()=>assert.equal(hits([commit('p1',{binding:null})]).length,0));
await check('wrong Project binding excludes result',()=>assert.equal(hits([commit('p1',{binding:{...binding(),repositoryId:'repo2'}})]).length,0));
await check('incremental replacement removes commits for missing binding',()=>{const merged=index.mergeProjectCorpus(corpus(),corpus([]),'p1');assert.equal(merged.sourceCommits.length,0)});
await check('incremental replacement retains unrelated Project commit',()=>{const merged=index.mergeProjectCorpus(corpus([commit('p1'),commit('p2')],[project('p1'),project('p2')]),corpus([]),'p1');assert.equal(merged.sourceCommits.length,1);assert.equal(merged.sourceCommits[0].projectId,'p2');});
const fresh=(projectId='p1')=>({id:'commit1',repositoryId:'repo1',revision:'abcdefabcdefabcd',message:'Fix load race\nFull description',authorName:'Author',updatedAt:T,repository:{id:'repo1',name:'Shared Git',updatedAt:T,archived:false,projects:[{...binding(projectId),project:{sourceBindings:[binding(projectId)]}}]}});
const h=(row=fresh(),opts={})=>{const calls=[];const prisma={project:{findMany:async(args)=>{calls.push(['project',args]);return [project('p1'),project('p2')].filter(x=>args.where.id.in.includes(x.id)).map(x=>({...x,updatedAt:opts.projectUpdated||T,sourceBindings:x.id==='p1' ? (opts.activeBinding===undefined?[binding()]:opts.activeBinding) : []}))}},sourceCommit:{findMany:async(args)=>{calls.push(['sourceCommit',args]);if(opts.fail)throw Error('DB down');return row?[row]:[];}}};return {admission:createSearchLiveAdmission(prisma),calls};};
const expectAdmission=async(name,row,expected,opts={})=>check(name,async()=>{const handle=h(row,opts),candidate=hits()[0];await handle.admission.prepareBatch([candidate]);assert.equal(handle.admission.admit(candidate),expected);assert.equal(handle.calls.length,2);});
await expectAdmission('exact commit in current active binding admitted',fresh(),true);
await expectAdmission('missing commit denied',null,false);
await expectAdmission('commit edit invalidates stale title', {...fresh(),updatedAt:T2},false);
await expectAdmission('commit content changed without timestamp denied', {...fresh(),message:'Sensitive unindexed commit'},false);
await expectAdmission('revision changed without timestamp denied', {...fresh(),revision:'cccccccccccccccc'},false);
await expectAdmission('repository title changed without timestamp denied',{...fresh(),repository:{...fresh().repository,name:'New Private Name'}},false);
await expectAdmission('commit reassignment to other repository denied',{...fresh(),repositoryId:'repo2'},false);
await expectAdmission('archived repository denied',{...fresh(),repository:{...fresh().repository,archived:true}},false);
await expectAdmission('renamed repository invalidates old Search title',{...fresh(),repository:{...fresh().repository,updatedAt:T2}},false);
await expectAdmission('removed Project binding denied',fresh(),false,{activeBinding:[]});
await expectAdmission('changed binding revision denied',fresh(),false,{activeBinding:[{...binding(),updatedAt:T2}]});
await expectAdmission('secondary binding denied',fresh(),false,{activeBinding:[{...binding(),id:'other-primary'}]});
await expectAdmission('Project mutation invalidates child commit',fresh(),false,{projectUpdated:T2});
await check('result for other Project cannot reuse first Project placement',async()=>{const handle=h(fresh('p1'));const rows=hits([commit('p1'),commit('p2')],[project('p1'),project('p2')]);await handle.admission.prepareBatch(rows);assert.equal(handle.admission.admit(rows[0]),true);assert.equal(handle.admission.admit(rows[1]),false);});
await check('unprepared commit is denied',()=>assert.equal(h().admission.admit(hits()[0]),false));
await check('broken database fails closed rather than permitting cached content',async()=>{await assert.rejects(()=>h(fresh(),{fail:true}).admission.prepareBatch(hits()),/DB down/);});
await check('out of range admission batch fails closed',async()=>{await assert.rejects(()=>h().admission.prepareBatch(Array.from({length:13},(_,i)=>({...hits()[0],id:`p1:c${i}`}))),/batch exceeded/);});
await check('source commit loader uses one active Project binding, not a per-commit join',async()=>{
  const repository=load('apps/server/src/domains/search/search-repository.ts', {
    '../access/authorization.js':{AUTHORIZATION_RULE_SELECT:{}},
    '../workforce/workforce-user-authority.js':{WORKFORCE_USER_AUTHORITY_INCLUDE:{}},
  });
  const queried=[];
  const fakePrisma={
    project:{findMany:async query=>{queried.push(['project',query]);return [
      {id:'p1',sourceBindings:[{...binding('p1'),repository:{id:'repo1',name:'Git',archived:false}}]},
      {id:'p2',sourceBindings:[{...binding('p2'),repository:{id:'repo1',name:'Git',archived:false}}]},
      {id:'p3',sourceBindings:[{...binding('p3'),repository:{id:'repo1',name:'Git',archived:true}}]},
    ];}},
    sourceCommit:{findMany:async query=>{queried.push(['commit',query]);return [
      {id:'commit1',repositoryId:'repo1',revision:'abcdefabcdefabcd',message:'Fix',updatedAt:T,
       repository:{id:'repo1',name:'Git',archived:false,updatedAt:T}}
    ];}},
  };
  const result=await repository.loadSourceCommits(fakePrisma,['p1','p2','p3'],100);
  assert.equal(result.length,2);assert.deepEqual(Array.from(result,row=>row.projectId),['p1','p2']);
  assert.equal(queried.length,2);assert.equal(queried[1][1].take,100);
  assert.deepEqual(Array.from(queried[1][1].where.repositoryId.in),['repo1']);
  assert.equal(queried[0][1].select.sourceBindings.take,1);
  assert(!('authorEmail' in queried[1][1].select));
  assert.equal((await repository.loadSourceCommits(fakePrisma,[],100)).length,0);
  assert.equal(queried.length,2);
});
await check('source commit loader never exceeds its projection limit',async()=>{
  const repository=load('apps/server/src/domains/search/search-repository.ts',{
    '../access/authorization.js':{AUTHORIZATION_RULE_SELECT:{}},
    '../workforce/workforce-user-authority.js':{WORKFORCE_USER_AUTHORITY_INCLUDE:{}},
  });
  const fake={project:{findMany:async()=>['p1','p2','p3'].map(id=>({id,sourceBindings:[{...binding(id),repository:{id:'repo1',archived:false}}]}))},
    sourceCommit:{findMany:async()=>[{id:'commit1',repositoryId:'repo1',repository:{id:'repo1',name:'Git',archived:false,updatedAt:T}}]}};
  assert.equal((await repository.loadSourceCommits(fake,['p1','p2','p3'],2)).length,2);
});
await check('commit corpus does not query when no active Project binding exists',async()=>{
  const repository=load('apps/server/src/domains/search/search-repository.ts',{
    '../access/authorization.js':{AUTHORIZATION_RULE_SELECT:{}},
    '../workforce/workforce-user-authority.js':{WORKFORCE_USER_AUTHORITY_INCLUDE:{}},
  });
  const fake={project:{findMany:async()=>[{id:'p1',sourceBindings:[]}]},sourceCommit:{findMany:async()=>{throw Error('should not load commit');}}};
  assert.equal((await repository.loadSourceCommits(fake,['p1'],100)).length,0);
});
await check('repo/commit corpus loader bounded and Project scoped',()=>{const source=src('apps/server/src/domains/search/search-repository.ts');for(const needle of ['loadSourceCommits(prisma, projectIds, SEARCH_CORPUS_LIMITS.sourceCommits)','loadSourceCommits(prisma, [projectId], PROJECT_REFRESH_LIMITS.sourceCommits)','placed.length >= limit','sourceCommits: []','sourceCommits.length, SEARCH_CORPUS_LIMITS.sourceCommits']) assert(source.includes(needle),needle);});
await check('sourceControl and Project checks precede privileged shortcut',()=>{const route=src('apps/server/src/domains/search/search-routes.ts');const start=route.indexOf('if (item.kind === "source_commit")'),end=route.indexOf('if (decorated?.isAdmin) return true;',start);assert(start>=0 && end>start);const block=route.slice(start,end);assert.match(block,/canViewTool\("sourceControl"\)/);assert.match(block,/canViewTarget\("project"/);});
await check('canonical source commit opens existing Project source inspector',()=>{assert.match(src('packages/renderer/src/features/workflow/resource-navigation.ts'),/kind === "source_commit"[^\n]+projectTab: "source", inspectScope: "source-commit"/);assert.match(src('packages/renderer/src/features/projects/ProjectChangesPanel.tsx'),/source-control\/commits\/\$\{encodeURIComponent\(focusedCommitId\)\}/);});
await check('scope and UI kind label exist',()=>{assert.match(src('packages/shared/src/cluster-manifest.ts'),/source_commit: \{ label: "Source commits"/);assert.match(src('packages/renderer/src/features/search/search-ranking.ts'),/kind === "source_commit"/);});
console.log(`TD4 R72 Source Commit checks: ${passed}/${passed} passed`);
