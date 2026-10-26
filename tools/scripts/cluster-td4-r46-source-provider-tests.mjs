import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const providerText = fs.readFileSync('apps/server/src/domains/changes/resource-change-providers.ts','utf8');
const compiled = ts.transpileModule(providerText, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = {exports:{}};
vm.runInNewContext(compiled, {
  module: mod, exports: mod.exports,
  require: id => id === '../access/studio-audience.js' ? {studioAudienceMatchesContext:()=>false} : (()=>{throw new Error('Unmocked '+id)})(),
  Map, Set, Promise, Error, String, Array, Boolean,
}, {filename:'resource-change-providers.ts'});
const { loadResourceChangeProviderSnapshot, isEnrolledResourceChangeProvider } = mod.exports;
let repoArchived=false, bindingArchived=false, grants=true, tool=true, failProvider=false;
let projects=['P1','P2'];
const bindings=()=>projects.map(projectId=>({projectId, archived:bindingArchived}));
const prisma={
  sourceRepository:{findMany:async({where,select})=>{assert.ok(select.projects.where.archived===false);if(failProvider)throw new Error('source provider offline');return !repoArchived&&where.id.in.includes('R1')?[{id:'R1',projects:bindings().filter(x=>!x.archived)}]:[]}},
  sourceCommit:{findMany:async({where,select})=>{assert.equal(where.repository.archived,false);return !repoArchived&&where.id.in.includes('C1')?[{id:'C1',repository:{projects:bindings().filter(x=>!x.archived)}}]:[]}},
  sourceReview:{findMany:async({where,select})=>{assert.equal(where.repository.archived,false);return !repoArchived&&where.id.in.includes('V1')?[{id:'V1',projectId:'P2',repository:{projects:bindings().filter(x=>!x.archived)}}]:[]}},
};
const ctx={prisma,authorization:{hasToolPermission:()=>tool,hasTargetAccess:(_user,_role,kind,id,project,rules)=>{
  assert.equal(kind,'project');assert.equal(id,project.id);
  return grants&&!rules.some(rule=>rule.targetId===id&&rule.effect==='deny');
}},user:{id:'U1'},role:'member',rules:[],projects:new Map(projects.map(id=>[id,{id}]))};
const change=(kind,id,projectId)=>({resource:{kind,id,...(projectId===undefined?{}:{projectId})},sequence:'1',eventType:'resource.updated',occurredAt:'2026-10-15T00:00:00Z'});
let checks=0;
async function check(name, action){try{await action();checks++;console.log('PASS',name)}catch(e){console.error('FAIL',name,e);process.exitCode=1}}
async function see(events,context=ctx){const snapshot=await loadResourceChangeProviderSnapshot(prisma,events);return {snapshot,allowed:snapshot.visible(context)}}
await check('all three Source Control kinds enrolled',()=>{for(const kind of ['source_repository','source_review','source_commit'])assert.equal(isEnrolledResourceChangeProvider(kind),true)});
await check('a linked repository permits Project-scoped invalidation',async()=>{assert.equal((await see([change('source_repository','R1','P1')])).allowed.size,1)});
await check('repository rejects unlinked or forged Project IDs',async()=>{assert.equal((await see([change('source_repository','R1','EVIL')])).allowed.size,0)});
await check('one inaccessible Project binding does not authorize another scoped event',async()=>{
  const restricted={...ctx,rules:[{targetId:'P2',effect:'deny'}]};
  assert.equal((await see([change('source_repository','R1','P2')],restricted)).allowed.size,0);
  assert.equal((await see([change('source_repository','R1','P1')],restricted)).allowed.size,1);
});
await check('unscoped repository event permitted through any accessible active binding',async()=>{
  const restricted={...ctx,rules:[{targetId:'P1',effect:'deny'}]};
  assert.equal((await see([change('source_repository','R1')],restricted)).allowed.size,1);
});
await check('unscoped event denied when no bound Project is visible',async()=>{
  const restricted={...ctx,rules:projects.map(targetId=>({targetId,effect:'deny'}))};
  assert.equal((await see([change('source_repository','R1')],restricted)).allowed.size,0);
});
await check('repository and commit snapshot loads Access Rules for both bound Projects',async()=>{
  const {snapshot}=await see([change('source_repository','R1'),change('source_commit','C1')]);
  assert.deepEqual([...snapshot.projectIds].sort(),['P1','P2']);
});
await check('commit cannot be exposed with unrelated Project scope',async()=>{
  assert.equal((await see([change('source_commit','C1','P9')])).allowed.size,0);
  assert.equal((await see([change('source_commit','C1','P2')])).allowed.size,1);
});
await check('review requires canonical Project, not just any repository binding',async()=>{
  assert.equal((await see([change('source_review','V1','P1')])).allowed.size,0);
  assert.equal((await see([change('source_review','V1','P2')])).allowed.size,1);
  assert.equal((await see([change('source_review','V1')])).allowed.size,1);
});
await check('review Project deny cannot be bypassed via other repository binding',async()=>{
  const restricted={...ctx,rules:[{targetId:'P2',effect:'deny'}]};
  assert.equal((await see([change('source_review','V1')],restricted)).allowed.size,0);
});
await check('source tool disable/revoked permission blocks all source kinds',async()=>{
  tool=false;for(const [kind,id] of [['source_repository','R1'],['source_commit','C1'],['source_review','V1']])assert.equal((await see([change(kind,id)])).allowed.size,0);
  tool=true;grants=false;assert.equal((await see([change('source_repository','R1')])).allowed.size,0);grants=true;
});
await check('archived repository blocks all three kinds',async()=>{
  repoArchived=true;for(const [kind,id] of [['source_repository','R1'],['source_commit','C1'],['source_review','V1']])assert.equal((await see([change(kind,id)])).allowed.size,0);repoArchived=false;
});
await check('archived binding cannot authorize repository or commit invalidation',async()=>{
  bindingArchived=true;
  assert.equal((await see([change('source_repository','R1')])).allowed.size,0);
  assert.equal((await see([change('source_commit','C1')])).allowed.size,0);
  assert.equal((await see([change('source_review','V1')])).allowed.size,0);
  bindingArchived=false;
});
await check('review must still have active binding for its own Project',async()=>{
  projects=['P1'];assert.equal((await see([change('source_review','V1')])).allowed.size,0);
  projects=['P1','P2'];
});
await check('unknown Source Control IDs never appear',async()=>{
  const {allowed}=await see([change('source_repository','X'),change('source_commit','X'),change('source_review','X')]);assert.equal(allowed.size,0);
});
await check('database failure aborts provider load',async()=>{
  failProvider=true;await assert.rejects(see([change('source_repository','R1')]),/source provider offline/);failProvider=false;
});
await check('repository item cannot be treated as a commit or review ID',async()=>{
  const {allowed}=await see([change('source_commit','R1'),change('source_review','R1')]);assert.equal(allowed.size,0);
});
await check('provider validates envelope Project scope independently per event',async()=>{
  const {allowed}=await see([change('source_repository','R1','P1'),change('source_repository','R1','P99')]);assert.equal(allowed.size,1);
});
await check('unscoped review and commit attach Project Rule lookup to snapshot',async()=>{
  const {snapshot}=await see([change('source_review','V1'),change('source_commit','C1')]);assert.deepEqual([...snapshot.projectIds].sort(),['P1','P2']);
});
if(process.exitCode)process.exit(process.exitCode);console.log(`${checks}/${checks} R46 source provider checks passed`);
// Confirm the Source Review queue no longer masks a failed permission lookup.
// This is a source contract check; live PostgreSQL behavior remains a separate gate.
const reviewRoute = fs.readFileSync('apps/server/src/domains/source-control/source-control-routes.ts','utf8');
const ruleLoader = reviewRoute.match(/const rules = projectIds\.length \? await deps\.prisma\.accessRule\.findMany\([\s\S]*?\) : \[\];/);
assert.ok(ruleLoader, 'Source Review queue must load access rules without a silent fallback');
assert.doesNotMatch(ruleLoader[0], /\.catch\(\s*\(\)\s*=>\s*\[\]\s*\)/);
console.log('PASS Source Review queue fails closed when Access Rule lookup rejects');
