import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(root, 'tools/scripts/cluster-tool.mjs');
const read = name => fs.readFileSync(path.join(root,name),'utf8');
const run = (...args) => spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8'});
let passed=0;
function check(label, fn) { fn(); passed++; console.log('PASS',label); }
const manifestPath='packages/shared/src/cluster-manifest.ts';
const registryPath='packages/renderer/src/features/application/modules/application-standalone-tool-registry.tsx';
const appPath='packages/renderer/src/features/application/ClusterApplication.tsx';
const prefetchPath='packages/renderer/src/features/shell/feature-prefetch.ts';
const lazyPath='packages/renderer/src/features/application/modules/application-lazy-workspaces.ts';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cluster-tool-contract-'));
try {
  check('Canonical route, permission and standalone registry are consistent',()=>{
    const result=run('check');
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/28 routes, 22 permission identities, 3 standalone modules/);
  });
  check('Existing tool routes require no individual app rendering branches',()=>{
    const app=read(appPath);const prefetch=read(prefetchPath);const registry=read(registryPath);
    assert.match(app,/isStandaloneToolRoute\(screen\) && <StandaloneToolRoute/);
    assert.match(prefetch,/preloadStandaloneTool\(screen\)/);
    assert.match(registry,/satisfies Record<ClusterStandaloneToolRouteId, StandaloneToolModule>/);
    for (const route of ['inventory','vault','integrations']) {
      assert.match(registry,new RegExp(`\\b${route}: \\{`));
      assert.doesNotMatch(prefetch,new RegExp(`\\b${route}: \\(\\) => import`));
    }
  });
  check('Tool directory lists canonical permission definitions and opens through authorized navigation',()=>{
    const directory=read('packages/renderer/src/features/admin/ToolDirectoryPanel.tsx');
    const shell=read('packages/renderer/src/features/application/modules/application-admin-workspaces.tsx');
    const app=read(appPath);
    assert.match(directory,/CLUSTER_TOOL_PERMISSION_KEYS\.map/);
    assert.match(directory,/Open tool/);
    assert.match(shell,/<ToolDirectoryPanel onConfigure/);
    assert.match(app,/!isAppScreen\(target.screen\) \|\| !canOpenScreen\(activeUser, target.screen\)/);
  });
  // Use a minimal copy of the exact files that the validator reads.
  for(const p of [manifestPath,registryPath,appPath,prefetchPath,lazyPath]){
    const target=path.join(tmp,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,p),target);
  }
  const mutate=(name,callback)=>{
    const file=path.join(tmp,name);const original=fs.readFileSync(file,'utf8');
    fs.writeFileSync(file,callback(original));
    const result=run('check','--root',tmp);
    fs.writeFileSync(file,original);
    return result;
  };
  check('Missing module is rejected',()=>{
    const result=mutate(registryPath,s=>s.replace('  vault: {\n    preload: inventoryLoader,','  lostVault: {\n    preload: inventoryLoader,'));
    assert.notEqual(result.status,0);assert.match(result.stderr,/vault: no renderer module registered/);
  });
  check('Unregistered module is rejected',()=>{
    const result=mutate(registryPath,s=>s.replace('  inventory: {\n','  noRoute: {\n'));
    assert.notEqual(result.status,0);assert.match(result.stderr,/noRoute: renderer module has no canonical standalone route/);
  });
  check('Unknown permission key fails closed',()=>{
    const result=mutate(manifestPath,s=>s.replace('tool: "inventory", startEligible: true','tool: "missingPermission", startEligible: true'));
    assert.notEqual(result.status,0);assert.match(result.stderr,/unknown permission tool missingPermission/);
  });
  check('Tool scaffold writes safe unregistered source and does not overwrite',()=>{
    const out=path.join(tmp,'generated');
    const result=run('new','--id','studioNotes','--label','Studio Notes','--admin-only','--out',out);
    assert.equal(result.status,0,result.stderr);
    const guide=fs.readFileSync(path.join(out,'studioNotes/INTEGRATION.md'),'utf8');
    assert.match(guide,/server API operation through central authorization/);
    assert.match(guide,/DOES NOT enable a new route/);
    const page=fs.readFileSync(path.join(out,'studioNotes/StudioNotesToolPage.tsx'),'utf8');
    assert.match(page,/export function StudioNotesToolPage/);
    assert.notEqual(run('new','--id','studioNotes','--label','Studio Notes','--out',out).status,0);
  });
  check('Tool scaffold rejects unsafe or unsupported identifiers',()=>{
    assert.notEqual(run('new','--id','../../escape','--label','Escape','--out',tmp).status,0);
    assert.notEqual(run('new','--id','niceTool','--label','<script>','--out',tmp).status,0);
  });
  check('Current edited TS/TSX files parse cleanly',()=>{
    for(const f of [manifestPath,registryPath,appPath,prefetchPath,'packages/renderer/src/features/admin/ToolDirectoryPanel.tsx','packages/renderer/src/features/application/modules/application-admin-workspaces.tsx','packages/renderer/src/features/workflow/work-navigation-types.ts']){
      const src=read(f);
      const result=ts.transpileModule(src,{fileName:f,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});
      const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
      assert.equal(errors.length,0,`${f}: ${errors.map(x=>ts.flattenDiagnosticMessageText(x.messageText,' '))}`);
    }
  });
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
console.log(`Cluster tool registry: ${passed} checks passed`);
