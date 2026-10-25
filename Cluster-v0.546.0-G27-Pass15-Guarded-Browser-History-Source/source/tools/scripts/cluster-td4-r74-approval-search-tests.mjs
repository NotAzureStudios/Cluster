/** R74: canonical admin approval discovery, live admission, exact queue navigation. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root','-g'], { encoding: 'utf8' }).trim(),'typescript/lib/typescript.js')); } })();
const src = file => readFileSync(file,'utf8');
function load(file, imports={}) {
  const emitted = ts.transpileModule(src(file),{ compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics:true });
  assert.equal(emitted.diagnostics?.length||0,0);
  const mod={exports:{}};
  vm.runInNewContext(emitted.outputText,{module:mod,exports:mod.exports,require(id){if(!(id in imports))throw Error('Unexpected '+id);return imports[id]},Date,Map,Set,Error,Boolean,Number,String,Array,Promise,Object,JSON,console},{filename:file});
  return mod.exports;
}
const builder=load('apps/server/src/domains/search/search-index-builder.ts',{
  '@cluster/shared': { CLUSTER_WORKFLOW_RELATIONSHIP_META:{}, clusterResourceAddressFromEntity:()=>null },
  '../workforce/workforce-user-authority.js': { workforceAuthorityProjection:()=>({skills:[]}) },
});
const {createSearchLiveAdmission}=load('apps/server/src/domains/search/search-live-admission.ts');
const NOW='2026-10-16T16:00:00.000Z', LATER='2026-10-16T16:01:00.000Z';
const item=(extra={})=>({id:'approval-one',kind:'approvalRequest',title:'Approve external release',status:'pending',archived:false,updatedAt:NOW,createdAt:NOW,...extra});
const corpus=(approvalRequests=[item()])=>({projects:[],users:[],cards:[],timelineItems:[],calendarEvents:[],cardComments:[],activityEvents:[],projectFiles:[],videoAssets:[],deliveryRecords:[],sourceReviews:[],sourceCommits:[],projectRelationships:[],packetDefinitions:[],studioPolicies:[],studioForms:[],formSubmissions:[],approvalRequests,accessRules:[]});
const approval=()=>builder.buildIndex(corpus()).items.find(x=>x.kind==='approval');
let count=0;
const check=async (name,fn)=>{await fn();count++;console.log('PASS',name)};
await check('Approval search row receives global canonical address',()=>{const x=approval();assert(x);assert.equal(x.resource.kind,'approval');assert.equal(x.resource.id,'approval-one');assert.equal(x.projectId,undefined)});
await check('Title and pending status indexed',()=>{const x=approval();assert.match(x.normalizedTitle,/external release/);assert.equal(x.status,'pending')});
await check('No approval payload, person names, reasons or notes indexed',()=>{const x=builder.buildIndex(corpus([item({reason:'SECRET_REASON',payload:'SECRET_PAYLOAD',requestedByName:'SECRET_PERSON',reviewNote:'SECRET_NOTE',projectId:'secret-project'})])).items.find(y=>y.kind==='approval');for(const secret of ['SECRET_REASON','SECRET_PAYLOAD','SECRET_PERSON','SECRET_NOTE','secret-project'])assert(!JSON.stringify(x).includes(secret),secret)});
await check('Archived and deleted approvals omitted',()=>{const x=builder.buildIndex(corpus([item({archived:true}),item({id:'removed',deletedAt:NOW})])).items;assert(!x.some(y=>y.kind==='approval'))});
await check('Wrong persistence kind excluded',()=>assert.equal(builder.buildIndex(corpus([item({kind:'other'})])).items.filter(x=>x.kind==='approval').length,0));
await check('Approval survives unrelated Project index refresh',()=>{const merged=builder.mergeProjectCorpus(corpus(),corpus([]),'project2');assert.equal(merged.approvalRequests.length,1)});
function fixture(opts={}){const calls=[];return {calls, ...createSearchLiveAdmission({ clusterPersistenceRecord: {findMany: async ({where,select})=>{calls.push({where,select});if(opts.fail)throw Error('database offline');return (opts.rows || [item()]).filter(r=>where.id.in.includes(r.id)&&r.kind===where.kind&&!r.archived&&!r.deletedAt)} } })};}
const admitted=async opts=>{const f=fixture(opts),x=approval();await f.prepareBatch([x]);return f.admit(x)};
await check('Unprepared approval denied',()=>assert.equal(fixture().admit(approval()),false));
await check('Unchanged live approval admitted',async()=>assert.equal(await admitted(),true));
await check('Missing approval denied',async()=>assert.equal(await admitted({rows:[]}),false));
await check('Renamed approval denied without timestamp movement',async()=>assert.equal(await admitted({rows:[item({title:'Restricted internal title'})]}),false));
await check('Decision transition denied until refresh',async()=>assert.equal(await admitted({rows:[item({status:'approved'})]}),false));
await check('Updated approval denied',async()=>assert.equal(await admitted({rows:[item({updatedAt:LATER})]}),false));
await check('Archived approval denied',async()=>assert.equal(await admitted({rows:[item({archived:true})]}),false));
await check('Deleted approval denied',async()=>assert.equal(await admitted({rows:[item({deletedAt:NOW})]}),false));
await check('Different persistence kind denied',async()=>assert.equal(await admitted({rows:[item({kind:'systemEvent'})]}),false));
await check('Database failure fails closed',async()=>{const f=fixture({fail:true});await assert.rejects(()=>f.prepareBatch([approval()]),/database offline/);assert.equal(f.admit(approval()),false)});
await check('DB query constrained to approvalRequest and no PII projection',async()=>{const f=fixture();await f.prepareBatch([approval()]);assert.equal(f.calls[0].where.kind,'approvalRequest');for(const secret of ['payload','userId','ownerId','reason','sourceKey']) assert(!Object.keys(f.calls[0].select).includes(secret),secret)});
await check('Admission bound at 12 records',async()=>{const f=fixture();await assert.rejects(()=>f.prepareBatch(Array.from({length:13},(_,i)=>({...approval(),id:`different-${i}`}))),/batch exceeded/)});
const textFile=(f)=>src(f);
await check('Approval Search authorization precedes administrator bypass',()=>{const s=textFile('apps/server/src/domains/search/search-routes.ts');const start=s.indexOf('if (item.kind === "approval")');const bypass=s.indexOf('if (decorated?.isAdmin) return true;',start);assert(start>0&&bypass>start);assert.match(s.slice(start,bypass),/decorated\?\.isAdmin/)});
await check('Search repository excludes decision payload and requester identifiers',()=>{const s=textFile('apps/server/src/domains/search/search-repository.ts');const start=s.indexOf('where: { kind: "approvalRequest"');assert(start>0);const block=s.slice(start,start+400);assert.match(block,/select: \{ id: true, kind: true/);for(const secret of ['payload: true','requestedById: true','userId: true','ownerId: true'])assert(!block.includes(secret))});
await check('Global approval queue and decisions are admin-only, not Project manager accessible',()=>{const s=textFile('apps/server/src/app/server-routes-access-media.ts');const start=s.indexOf('async function adminForApprovals(');const end=s.indexOf('app.get("/api/projects/',start);assert(start>0 && end>start);const guard=s.slice(start,end);assert.match(guard,/!decorated\?\.isAdmin/);assert(!guard.includes('hasToolPermission'));for(const r of ['/api/admin/approvals"','/api/admin/approvals/:approvalId"','/api/admin/approvals/:approvalId/decision"']){assert(s.includes(r),r)};});
await check('Exact-record endpoint is auth checked and no-store',()=>{const s=textFile('apps/server/src/app/server-routes-access-media.ts');const start=s.indexOf('app.get("/api/admin/approvals/:approvalId"');const end=s.indexOf('app.post("/api/admin/approvals/:approvalId/decision"',start);assert(start>0&&end>start);const block=s.slice(start,end);assert.match(block,/Cache-Control.*private, no-store/);assert.match(block,/adminForApprovals/);assert.match(block,/decisions.get\(approvalId\)/);assert.match(block,/404/)});
await check('Exact route supports avatar audit ID but not broad list lookup',()=>{const s=textFile('apps/server/src/app/server-routes-access-media.ts');const start=s.indexOf('app.get("/api/admin/approvals/:approvalId"');const end=s.indexOf('app.post("/api/admin/approvals/:approvalId/decision"',start);const block=s.slice(start,end);assert.match(block,/approvalId.startsWith\("avatar:"\)/);assert.match(block,/avatarAudit.findUnique/);assert(!block.includes('decisions.list('))});
await check('Navigation uses canonical admin approval inspect target',()=>{const s=textFile('packages/renderer/src/features/workflow/resource-navigation.ts');assert.match(s,/kind === "approval"[^\n]+screen: "admin"[^\n]+inspectScope: "approval"/)});
await check('App verifies admin before opening approval destination',()=>{const s=textFile('packages/renderer/src/features/application/ClusterApplication.tsx');const start=s.indexOf('target.screen === "admin" && target.inspectScope === "approval"');assert(start>0);assert.match(s.slice(start,start+250),/!activeUser\?\.isAdmin/);assert.match(s.slice(start,start+300),/section: "approvals"/)});
await check('Admin route restores Approvals section',()=>{const s=textFile('packages/renderer/src/features/application/ClusterApplication.tsx');assert.match(s,/initialSection=\{routeSection === "approvals" \? "approvals" : undefined\}/)});
await check('Queue permalink resolves exact record and clears limiting filters',()=>{const s=textFile('packages/renderer/src/features/admin/AdminApprovalCenter.tsx');assert.match(s,/api<\{ approval: ApprovalItem \}>\(`/);for(const k of ['setStatusFilter("all")','setPriorityFilter("all")','setTypeFilter("all")','setProjectFilter("all")','setAgingOnly(false)'])assert(s.includes(k));assert.match(s,/targetSequenceRef\.current !== sequence/)});
await check('Invalid target cannot select unrelated approval by fallback',()=>{const s=textFile('packages/renderer/src/features/admin/AdminApprovalCenter.tsx');assert.match(s,/if \(targetId\) return;\s*if \(visible.length/)});
await check('Copy Link uses shared work action with canonical approval source',()=>{const s=textFile('packages/renderer/src/features/admin/AdminApprovalCenter.tsx');assert.match(s,/copyWorkLink\(\{ source: \{ kind: "approval"/);assert.match(s,/inspectScope: "approval", inspectId: selected.id/)});
await check('Queue refresh keeps separately resolved old target',()=>{const s=textFile('packages/renderer/src/features/admin/AdminApprovalCenter.tsx');assert.match(s,/const pinned = targetId \? current.find/);assert.match(s,/\[pinned, \.\.\.next\]/)});
await check('Approval is included in resource and search vocabulary',()=>{const manifest=textFile('packages/shared/src/cluster-manifest.ts'),addresses=textFile('packages/shared/src/resource-address.ts');assert.match(manifest,/approval: \{ label: "Approvals"/);assert.match(addresses,/"form_submission", "approval"/)});
await check('Approval search label and kind alias are available',()=>{assert.match(textFile('packages/renderer/src/features/search/search-ranking.ts'),/kind === "approval"/);assert.match(textFile('apps/server/src/domains/search/search-query-runtime.ts'),/approval: "approval"/)});
console.log(`TD4 R74 approval search: ${count}/${count} passed`);
