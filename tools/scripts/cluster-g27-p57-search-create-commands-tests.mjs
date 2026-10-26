import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'typescript/lib/typescript.js')); } })();
const file = (relative) => readFileSync(new URL('../../' + relative, import.meta.url), 'utf8');
const catalog = file('packages/shared/src/cluster-manifest.ts');
const modeBlock = catalog.split('export const CLUSTER_CREATE_MODE_MANIFEST = {')[1].split('} as const satisfies Record<string, ClusterCreateModeDefinition>')[0];
const modeIds = [...modeBlock.matchAll(/^\s{2}(\w+):\s*\{/gm)].map(m => m[1]);
assert.equal(modeIds.length, 11);
const toolByMode = {project:'projects',card:'boards',ticket:'tickets',bug:'tickets',build:'builds',timeline:'timeline',calendar:'calendar',scheduler:'scheduler',meeting:'projects',whiteboard:'whiteboards',packet:'packets'};
const level = {none:0,view:1,edit:2,manage:3};
const stubPermission = (user, tool, minimum) => user.admin === true || level[user.tools?.[tool] || 'none'] >= level[minimum];
const js = ts.transpileModule(file('packages/renderer/src/features/create/create-mode-access.ts'), {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}}).outputText;
const module = {exports:{}};
vm.runInNewContext(js, {
  module, exports:module.exports,
  require(specifier) {
    if (specifier === '@cluster/shared') return { CLUSTER_CREATE_MODE_IDS: modeIds };
    if (specifier.endsWith('/permissions')) return {canUseTool:stubPermission};
    throw new Error('Unexpected Create dependency '+specifier);
  },
}, {filename:'create-mode-access.ts'});
const {canOfferCreateMode,availableCreateModes} = module.exports;
let n = 0; const check=(title,fn)=>{fn();n++;console.log('PASS '+title)};
check('all eleven canonical Create modes have a shared availability decision',()=>{
  assert.deepEqual(Object.keys(toolByMode).sort(), modeIds.slice().sort());
  const administrator={admin:true};
  assert.deepEqual([...availableCreateModes(administrator)].sort(),modeIds.slice().sort());
});
check('read-only account cannot create any type',()=>{
  assert.deepEqual([...availableCreateModes({tools:Object.fromEntries(Object.values(toolByMode).map(k=>[k,'view']))})],[]);
});
check('Project requires manage while Meeting requires Project edit',()=>{
  const editor={tools:{projects:'edit'}};
  assert.equal(canOfferCreateMode(editor,{},'project'),false);
  assert.equal(canOfferCreateMode(editor,{},'meeting'),true);
  assert.equal(canOfferCreateMode({tools:{projects:'manage'}},{},'project'),true);
});
check('tool ownership prevents cross-domain Create',()=>{
  const editor={tools:{calendar:'edit',boards:'edit'}};
  assert.deepEqual(Array.from(availableCreateModes(editor)).sort(),['calendar','card']);
});
check('Studio disabled-tool policy applies to both Create surfaces',()=>{
  for(const [mode,flag] of [['timeline','timelineEnabled'],['ticket','ticketsEnabled'],['bug','ticketsEnabled'],['calendar','calendarEnabled'],['scheduler','schedulerEnabled'],['packet','packetsEnabled']]) {
    assert.equal(canOfferCreateMode({admin:true},{[flag]:false},mode),false,mode);
    assert.equal(canOfferCreateMode({admin:true},{[flag]:true},mode),true,mode);
  }
});
check('a forged mode is never advertised',()=>assert.equal(canOfferCreateMode({admin:true},{},'admin-override'),false));
const drawer=file('packages/renderer/src/features/create/SharedCreateDrawer.tsx');
const search=file('packages/renderer/src/features/search/CommandPalette.tsx');
check('Create drawer and Search both use the same availability authority',()=>{
  assert.match(drawer,/canOfferMode\(currentUser, settings, candidate\)/);
  assert.match(search,/availableCreateModes\(user, settings\)/);
});
check('Search builds direct commands using canonical Create metadata',()=>{
  assert.match(search,/CREATE_MODE_CATALOG\.filter\(\(entry\) => permittedCreateModes\.includes\(entry\.id\)\)/);
  assert.match(search,/key: `action-create-\$\{entry\.id\}`/);
  assert.match(search,/title: `Create \$\{entry\.label\}`/);
});
check('direct Create commands use session-bound handoff and current authorized Project context',()=>{
  assert.match(search,/openSharedCreate\(entry\.id, entry\.id !== "project" && currentProject \? \{ projectId: currentProject\.id \} : \{\}\)/);
  assert.match(file('packages/renderer/src/features/create/shared-create-handoff.ts'),/bindSessionHandoff\(detail\)/);
});
check('empty Search avoids eleven unsolicited Create entries',()=>{
  assert.match(search,/searchTerm \|\| commandMode \? CREATE_MODE_CATALOG/);
});
check('Studio availability and permissions invalidate cached Search actions',()=>{
  assert.match(search,/activeWorkContext, settings, storedFavorites, currentScreen\]\)/);
});
check('session switching replaces an executing command gate',()=>{
  assert.match(search,/commandInvocationOwnerRef\.current !== searchOwner/);
  assert.match(search,/commandInvocation\.current = createClusterCommandInvocation\(\)/);
  assert.match(search,/commandRunSequence\.current \+= 1/);
});
check('old command promise cannot clear new pending indicator',()=>{
  assert.match(search,/commandRunSequence\.current === runId\) setCommandBusy\(false\)/);
  assert.match(search,/commandBusy && commandBusyOwner === searchOwner/);
  assert.match(search,/commandErrorOwner === searchOwner \? commandError : ""/);
});
console.log(`${n}/${n} G27 P57 direct Create/Search integration checks passed`);
