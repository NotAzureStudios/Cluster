/** TD3 R28 focused executable viewer-registry and source owner checks. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createViewerCommandRegistry } from '../../packages/renderer/src/features/viewer/viewer-command-registry.ts';
const root = resolve(import.meta.dirname, '../..');
const read = p => readFileSync(resolve(root,p), 'utf8');
const checks=[];
function test(name, check){checks.push([name,check]);}
const shell=read('packages/renderer/src/features/viewer/ViewerShell.tsx');
const pdf=read('packages/renderer/src/features/viewer/UnifiedPdfViewer.tsx');
const bar=read('packages/renderer/src/features/viewer/ViewerCommandBar.tsx');
const qml=read('apps/desktop-qt/qml/pages/AppSettingsWindow.qml');
const profiles=read('apps/desktop-qt/qml/pages/ServerProfilesWindow.qml');
const header=read('apps/desktop-qt/src/DesktopPreferences.h');
const cpp=read('apps/desktop-qt/src/DesktopPreferences.cpp');
const sidebar=read('packages/renderer/src/features/shell/sidebar.css');
const shellCss=read('packages/renderer/src/features/shell/shell.css');
test('System action errors propagate after user-facing status is updated',()=>{
  assert.match(shell, /setSystemStatusError\(true\);\s*setSystemStatus\(error instanceof Error[^;]+;\s*\/\/ The command surface[^\n]+\n\s*throw error;/);
  assert.match(shell, /role=\{systemStatusError \? "alert" : "status"\}/);
});
test('Viewer menu owns retry and does not dismiss rejected actions',()=>{
  assert.match(bar,/const completed = await registry\.execute\(command\.id, context\)/);
  assert.match(bar,/execution\.execute\(command\.id/);
  assert.match(bar,/canDismiss=\{\(\) => !execution\.isExecuting\(\)\}/);
});
test('All header/inspector entrypoints catch the same registry failure',()=>{
  assert.match(shell,/const invokeViewerCommand = useCallback\(/);
  assert.match(shell,/registry\.execute\(id, commandContext\)\.catch/);
  for(const id of ['review','shortcuts','overlays','inspector','fullscreen']) assert.ok(shell.includes(`invokeViewerCommand("viewer.shell.${id}")`),id);
  assert.equal((shell.match(/invokeViewerCommand\("viewer.system.detach"\)/g)||[]).length,2);
  assert.doesNotMatch(shell,/void registry\.execute\("viewer.system.detach", commandContext\)/);
});
test('PDF selection uses native/browser Cluster clipboard with failure propagation',()=>{
  assert.match(pdf,/import \{ copyClusterText \} from "\.\.\/\.\.\/core\/clipboard"/);
  assert.match(pdf,/copySelection: \(\) => Promise<void>/);
  assert.match(pdf,/if \(!selectedText\) throw new Error/);
  assert.match(pdf,/if \(!await copyClusterText\(selectedText\)\) throw new Error/);
  assert.doesNotMatch(pdf,/navigator\.clipboard\?\.writeText\(selectedText\)/);
});
test('PDF print/download reject missing or denied source rather than closing as success',()=>{
  assert.match(pdf, /if \(!source.url\) throw new Error\("The PDF source is not available for download\."\)/);
  assert.match(pdf, /if \(!source.url\) throw new Error\("The PDF source is not available for printing\."\)/);
  assert.match(pdf, /if \(!response.ok\) throw new Error\(`PDF printing could not start/);
});
test('Native preferences expose results from the C++ authority',()=>{
  for(const name of ['openLogsFolder','openApplicationData']) {
    assert.ok(header.includes(`Q_INVOKABLE bool ${name}();`),name);
    assert.ok(cpp.includes(`bool DesktopPreferences::${name}()`),name);
  }
  assert.equal((cpp.match(/return QDesktopServices::openUrl\(QUrl::fromLocalFile\(path\)\);/g)||[]).length,2);
});
test('Native settings display failed opens and responsive diagnostic actions',()=>{
  for(const name of ['openLogsFolder','openApplicationData','openProfilesFolder']) assert.ok(qml.includes(`root.reportDiagnosticsAction(clusterApp.${name==='openProfilesFolder'?'serverProfiles':'desktopPreferences'}.${name}()`),name);
  assert.match(qml,/columns: root\.width < 480 \? 1 : 3/);
  assert.match(qml,/root\.diagnosticsActionFailed \? Theme\.danger/);
  assert.match(qml,/root\.updateActionFailed \? Theme\.danger/);
  assert.match(qml,/const registered = clusterApp\.desktopPreferences\.registerShellIntegration\(\)/);
});
test('Native server profile controls report action failure rather than swallowing bools',()=>{
  for (const name of ['renameProfile','switchProfile','openProfileFolder','requestSignOut']) assert.ok(profiles.includes('!clusterApp.serverProfiles.'+name+'('),name);
  assert.match(profiles,/root\.formError = clusterApp\.serverProfiles\.lastOperationError \|\|/);
});
test('Sidebar row height has one owner and retains mobile target',()=>{
  assert.match(sidebar, /--cluster-sidebar-item-height: 38px/);
  assert.match(sidebar, /#cluster-sidebar \.cluster-sidebar__link \{[\s\S]*?min-height: var\(--cluster-sidebar-item-height\) !important/);
  assert.match(sidebar,/min-height: 44px !important/);
  assert.doesNotMatch(sidebar,/#cluster-sidebar \.cluster-sidebar__link \{\s*min-height: 36px !important/);
  assert.doesNotMatch(shellCss, /min-height:var\(--sidebar-row-height-v524\) !important/);
});
test('Registry reports actual thrown errors and releases lock for user retry',async()=>{
  let attempts=0;
  const registry=createViewerCommandRegistry([{id:'viewer.copy',label:'Copy',run:async()=>{attempts++;if(attempts===1)throw Error('clipboard denied');}}]);
  const ctx={capabilities:{},medium:'pdf',mode:'view'};
  await assert.rejects(registry.execute('viewer.copy',ctx),/clipboard denied/);
  assert.equal(await registry.execute('viewer.copy',ctx),true);
  assert.equal(attempts,2);
});
test('Parallel viewer invocations coalesce while an action is pending',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);let count=0;
  const registry=createViewerCommandRegistry([{id:'viewer.export',label:'Export',run:()=>{count++;return gate;}},{id:'viewer.open',label:'Open',run:()=>{count++;}}]);
  const ctx={capabilities:{},medium:'pdf',mode:'view'};
  const first=registry.execute('viewer.export',ctx);
  assert.equal(await registry.execute('viewer.open',ctx),false);
  release();assert.equal(await first,true);assert.equal(count,1);
  assert.equal(await registry.execute('viewer.open',ctx),true);
});
let failed=0;
for(const [name,run] of checks){try{await run();console.log('PASS',name)}catch(e){failed++;console.error('FAIL',name,e)}}
console.log(`${checks.length-failed}/${checks.length} TD3 R28 focused checks passed`);
if(failed)process.exitCode=1;
