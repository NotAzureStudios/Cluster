/** R71: source-review Search integration, navigation, and fail-closed admission. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js')); } })();
let total = 0;
const check = async (name, fn) => { await fn(); ++total; console.log('PASS',name); };
const source = file => readFileSync(file,'utf8');
const translated = file => {
  const emitted = ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal(emitted.diagnostics?.length || 0, 0);
  return emitted.outputText;
};
function load(file, imports = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(translated(file), {module:mod, exports:mod.exports, require(id) { if (!(id in imports)) throw Error('Unexpected import '+id); return imports[id]; }, Date, Map, Set, Error, Boolean, Number, String, Array, Promise, Object, JSON, console, performance}, {filename:file});
  return mod.exports;
}
const index = load('apps/server/src/domains/search/search-index-builder.ts', {
  '@cluster/shared': { CLUSTER_WORKFLOW_RELATIONSHIP_META: {}, clusterResourceAddressFromEntity: () => null },
  '../workforce/workforce-user-authority.js': { workforceAuthorityProjection: () => ({ skills: [] }) },
});
const { createSearchLiveAdmission } = load('apps/server/src/domains/search/search-live-admission.ts');
const TIME = '2026-10-15T02:00:00.000Z';
const AFTER = '2026-10-15T03:00:00.000Z';
const project = (id='p1') => ({id,name:`Project ${id}`,projectType:'General',status:'active',updatedAt:TIME, createdAt:TIME, archived:false, memberships:[], boards:[], controlRecords:[], whiteboards:[], libraryItems:[]});
const binding = (projectId='p1',updatedAt=TIME) => ({projectId,archived:false,updatedAt});
const review = (extra={}) => ({ id:'review1', projectId:'p1', repositoryId:'repo1', title:'Fix streaming pipeline', description:'Review source changes', status:'open', sourceBranch:'fix/stream', targetBranch:'main', createdAt:TIME, updatedAt:TIME,
 repository: { id:'repo1', name:'Studio repo', archived:false, updatedAt:TIME }, project: {sourceBindings:[{repositoryId:'repo1', updatedAt:TIME}]}, ...extra });
function corpus(reviewRecords=[review()]) { return { projects:[project()], users:[], cards:[], timelineItems:[], calendarEvents:[], cardComments:[], activityEvents:[], projectFiles:[], videoAssets:[], deliveryRecords:[], sourceReviews:reviewRecords, projectRelationships:[], packetDefinitions:[], studioPolicies:[], accessRules:[] }; }
const hit = () => index.buildIndex(corpus()).items.find(row=>row.kind==='source_review');
await check('source review indexes as canonical resource and Project navigation', () => {
  const item=hit(); assert(item); assert.equal(item.title,'Fix streaming pipeline'); assert.equal(item.resource.kind,'source_review'); assert.equal(item.resource.projectId,'p1'); assert.equal(item.projectUpdatedAt,TIME); assert.match(item.normalizedText,/streaming pipeline/);
});
await check('index excludes reviews with no live binding', () => assert(!index.buildIndex(corpus([review({project:{sourceBindings:[]}})])).items.some(row=>row.kind==='source_review')));
await check('index excludes archived repositories', () => assert(!index.buildIndex(corpus([review({repository:{...review().repository, archived:true}})])).items.some(row=>row.kind==='source_review')));
await check('index excludes reviews in missing Projects', () => assert(!index.buildIndex(corpus([review({projectId:'p2'})])).items.some(row=>row.kind==='source_review')));
await check('secondary repository review is not surfaced as primary Source tab content', () => assert(!index.buildIndex(corpus([review({repositoryId:'repo2'})])).items.some(row=>row.kind==='source_review')));
await check('indexed source metadata contains no reviewer identities', () => {const item=hit(); assert.equal(item.raw.reviewerIds,undefined); assert.equal(item.raw.repository.remoteUrl,undefined);});
await check('incremental Project refresh removes old reviews when source becomes empty', () => { const merged=index.mergeProjectCorpus(corpus(),{...corpus([]),projects:[project()]},'p1'); assert.equal(merged.sourceReviews.length,0); });
await check('incremental Project refresh preserves unrelated Project reviews', () => {const existing={...corpus(),sourceReviews:[review(),review({id:'r2',projectId:'p2'})]};const incoming={...corpus(),sourceReviews:[review({id:'r3'})]};const merged=index.mergeProjectCorpus(existing,incoming,'p1');assert.deepEqual(Array.from(merged.sourceReviews,r=>r.id),['r2','r3']);});
function harness(rows=[review()]) {
  const calls=[]; const db={
    project:{findMany:async({where})=>{calls.push(['project',where]);return [project()].filter(row=>where.id.in.includes(row.id));}},
    sourceReview:{findMany:async({where})=>{calls.push(['sourceReview',where]);return rows.filter(row=>where.id.in.includes(row.id));}},
  };
  return {admission:createSearchLiveAdmission(db),calls};
}
await check('unchanged live review, repository, binding and Project admitted', async()=>{const h=harness(); const result=hit();await h.admission.prepareBatch([result]);assert.equal(h.admission.admit(result),true);assert.equal(h.calls.length,2);});
await check('deleted review denied', async()=>{const h=harness([]);const result=hit();await h.admission.prepareBatch([result]);assert.equal(h.admission.admit(result),false);});
await check('edited review title denied until reindex', async()=>{const h=harness([review({updatedAt:AFTER})]);const result=hit();await h.admission.prepareBatch([result]);assert.equal(h.admission.admit(result),false);});
await check('moved review denied', async()=>{const h=harness([review({projectId:'p2'})]);const result=hit();await h.admission.prepareBatch([result]);assert.equal(h.admission.admit(result),false);});
await check('relinked review repository denied', async()=>{const h=harness([review({repositoryId:'repo2'})]);const result=hit();await h.admission.prepareBatch([result]);assert.equal(h.admission.admit(result),false);});
await check('archived repository denied', async()=>{const h=harness([review({repository:{...review().repository,archived:true}})]);const result=hit();await h.admission.prepareBatch([result]);assert.equal(h.admission.admit(result),false);});
await check('renamed repository denied until reindex', async()=>{const h=harness([review({repository:{...review().repository,updatedAt:AFTER}})]);const result=hit();await h.admission.prepareBatch([result]);assert.equal(h.admission.admit(result),false);});
await check('removed Project source binding denied', async()=>{const h=harness([review({project:{sourceBindings:[]}})]);const result=hit();await h.admission.prepareBatch([result]);assert.equal(h.admission.admit(result),false);});
await check('archived Project source binding selection denied', async()=>{const h=harness([review({project:{sourceBindings:[]}})]);const result=hit();await h.admission.prepareBatch([result]);assert.equal(h.admission.admit(result),false);});
await check('changed Project source binding denied', async()=>{const h=harness([review({project:{sourceBindings:[{repositoryId:'repo1',updatedAt:AFTER}]}})]);const result=hit();await h.admission.prepareBatch([result]);assert.equal(h.admission.admit(result),false);});
await check('binding for different primary repository cannot admit result', async()=>{const h=harness([review({project:{sourceBindings:[{repositoryId:'repo2',updatedAt:TIME}]}})]);const result=hit();await h.admission.prepareBatch([result]);assert.equal(h.admission.admit(result),false);});
await check('database read failure denies search rather than publishing old content', async()=>{ const h=harness();h.calls.length=0;const error=new Error('db unavailable');const db={project:{findMany:async()=>[project()]},sourceReview:{findMany:async()=>{throw error;}}}; await assert.rejects(()=>createSearchLiveAdmission(db).prepareBatch([hit()]),/db unavailable/); });
await check('unprepared review cannot be admitted',()=>{assert.equal(harness().admission.admit(hit()),false);});
const route=source('apps/server/src/domains/search/search-routes.ts');
await check('authorization requires sourceControl tool and Project ACL before admin shortcut',()=>{const candidate=route.indexOf('if (item.kind === "source_review")');const admin=route.indexOf('if (decorated?.isAdmin) return true;',candidate);assert(candidate>=0 && admin>candidate);const block=route.slice(candidate,admin);assert.match(block,/canViewTool\("sourceControl"\)/);assert.match(block,/canViewTarget\("project"/);});
await check('source review deep link uses existing Project source inspector',()=>{const nav=source('packages/renderer/src/features/workflow/resource-navigation.ts');assert.match(nav,/kind === "source_review"[^\n]+projectTab: "source", inspectScope: "source-review"/);});
await check('resource navigation reverse mapping supports all Source Control resource types',()=>{const actions=source('packages/renderer/src/features/workflow/work-actions.ts');for(const kind of ['source-review','source-repository','source-commit']) assert(actions.includes(`scope === "${kind}"`));});
await check('remote scope and UI label are registered',()=>{assert.match(source('packages/shared/src/cluster-manifest.ts'),/source_review: \{ label: "Source reviews"/);assert.match(source('packages/renderer/src/features/search/search-ranking.ts'),/kind === "source_review"/);});
await check('corpus loads source reviews and reports saturation separately',()=>{const s=source('apps/server/src/domains/search/search-repository.ts');assert.match(s,/loadSourceReviews\(prisma, projectIds, SEARCH_CORPUS_LIMITS.sourceReviews\)/);assert.match(s,/loadSourceReviews\(prisma, \[projectId\], PROJECT_REFRESH_LIMITS.sourceReviews\)/);assert.match(s,/\["sourceReviews", sourceReviews.length/);});
console.log(`TD4 R71 Source Review checks: ${total}/${total} passed`);
