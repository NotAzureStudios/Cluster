import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const source = (file) => readFileSync(new URL('../../'+file, import.meta.url), 'utf8');
const transpile = file => {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:module.exports,module},{filename:file});
  return module.exports;
};
const {CLUSTER_HELP_TOPICS,CLUSTER_HELP_NAVIGABLE_SCREENS,visibleHelpTopics,searchHelpTopics,canNavigateFromHelp}=transpile('packages/renderer/src/features/help/contextual-help.ts');
const manifestSource=source('packages/shared/src/cluster-manifest.ts');
const routesBlock=manifestSource.split('export const CLUSTER_APP_ROUTE_MANIFEST = {')[1].split('} as const satisfies Record<string, ClusterAppRouteDefinition>')[0];
const routes=[...routesBlock.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):\s*\{/gm)].map(m=>m[1]);
let n=0;const check=(title,fn)=>{fn();n++;console.log('PASS '+title)};
check('every canonical first-party route has exactly one Help topic',()=>{
  assert.equal(CLUSTER_HELP_TOPICS.length,routes.length);
  assert.deepEqual([...new Set(CLUSTER_HELP_TOPICS.map(t=>t.screen))].sort(),routes.slice().sort());
});
check('help topic content explains both common tasks and recovery',()=>{
  for (const t of CLUSTER_HELP_TOPICS){assert.ok(t.title && t.purpose && t.recovery);assert.ok(t.tasks.length>=2);}
});
check('restricted Vault/Activity/Integrations topics disappear for a non-admin',()=>{
  const visible=visibleHelpTopics(route=>!['vault','activity','integrations','serverConfig','studioSettings','admin'].includes(route));
  assert.ok(!visible.some(t=>t.screen==='vault'));
  assert.ok(visible.some(t=>t.screen==='inventory'));
});
check('search matches new feature-specific tasks',()=>{
  assert.ok(searchHelpTopics(CLUSTER_HELP_TOPICS,'credential rotation').some(t=>t.screen==='vault'));
  assert.ok(searchHelpTopics(CLUSTER_HELP_TOPICS,'equipment').some(t=>t.screen==='inventory'));
});
check('no duplicate navigable screens, and each has an article',()=>{
  assert.equal(CLUSTER_HELP_NAVIGABLE_SCREENS.length,new Set(CLUSTER_HELP_NAVIGABLE_SCREENS).size);
  assert.ok(CLUSTER_HELP_NAVIGABLE_SCREENS.every(route=>CLUSTER_HELP_TOPICS.some(topic=>topic.screen===route)));
});
check('record-scoped Project/Board/Whiteboard remain excluded from Help Open links',()=>{
  for(const route of ['project','board','whiteboard'])assert.equal(canNavigateFromHelp(route,()=>true),false);
});
check('admin-only navigation requires effective access',()=>{
  for(const route of ['vault','activity','integrations'])assert.equal(canNavigateFromHelp(route,()=>false),false);
});
check('new standalone workspaces navigate when authorized',()=>{
  for(const route of ['inventory','vault','integrations','myRecords','changelog']) assert.equal(canNavigateFromHelp(route,()=>true),true);
});
check('Help dialog rechecks permissions on interaction',()=>{
  const app=source('packages/renderer/src/features/help/ClusterHelpDialog.tsx');
  assert.match(app,/if \(canNavigateFromHelp\(active\.screen, canAccess\)\) onNavigate\(active\.screen\)/);
});
console.log(`${n}/${n} G27 Pass 55 help coverage checks passed`);
