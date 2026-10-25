import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createClusterCommandInvocation} from '../../packages/renderer/src/features/search/cluster-command-invocation.ts';
const root=resolve(import.meta.dirname,'../..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const tests=[];
function test(name,check){tests.push([name,check]);}
const deferred=()=>{let resolve;let reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return {resolve,reject,promise}};
const bar=read('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
const app=read('packages/renderer/src/features/application/ClusterApplication.tsx');
const css=read('packages/renderer/src/features/shell/shell.css');
const profiles=read('apps/desktop-qt/qml/pages/ServerProfilesWindow.qml');
const store=read('apps/desktop-qt/src/ServerProfileStore.cpp');
const surface=read('apps/desktop-qt/qml/components/Surface.qml');
const theme=read('apps/desktop-qt/qml/Theme.qml');

test('A synchronous native/user gesture enters shared single-flight immediately',async()=>{
 const gate=createClusterCommandInvocation();const calls=[];const pending=deferred();
 const attempt=gate.run(()=>{calls.push('open');return pending.promise});
 assert.deepEqual(calls,['open']);assert.equal(gate.isExecuting(),true);
 assert.equal(gate.run(()=>calls.push('duplicate')),null);
 pending.resolve(true);assert.equal(await attempt,true);assert.equal(gate.isExecuting(),false);
});
test('Clipboard denial does not count as confirmation; subsequent retries work',async()=>{
 const gate=createClusterCommandInvocation();assert.equal(await gate.run(()=>false),false);
 assert.equal(await gate.run(()=>Promise.resolve(false)),false);
 assert.equal(await gate.run(()=>true),true);
});
test('Native rejected/throwing command releases its one-flight lock',async()=>{
 const gate=createClusterCommandInvocation();assert.equal(await gate.run(()=>{throw Error('no active workspace')}),false);
 assert.equal(await gate.run(()=>Promise.reject(Error('native failure'))),false);
 assert.equal(gate.isExecuting(),false);
});
test('Account utility invokes existing shared command helper synchronously and observes the outcome',()=>{
 assert.match(bar,/import \{ createClusterCommandInvocation \}/);
 assert.match(bar,/const pending = accountUtilityInvocationRef\.current\.run\(action\)/);
 assert.match(bar,/if \(!pending\) return;/);
 assert.match(bar,/if \(confirmed\) setUserMenuOpen\(false\);\s*else setAccountUtilityError\(failure\)/);
 assert.match(bar,/finally\(\(\) => setAccountUtilityBusy\(false\)\)/);
});
test('Clipboard denial and native open failure keep menu open with actionable error',()=>{
 assert.match(bar,/invokeAccountUtility\(\(\) => copyClusterText\(shareable\), "Could not copy/);
 assert.match(bar,/invokeAccountUtility\(\(\) => openCurrentWorkInDesktopWindow\(currentRoute \|\| screen, "Cluster workspace"\), "The desktop window could not be opened/);
 assert.doesNotMatch(bar,/void openCurrentWorkInDesktopWindow\(currentRoute \|\| screen/);
 assert.match(bar,/\{accountUtilityError && <div role="alert"/);
 assert.match(bar,/aria-busy=\{accountUtilityBusy\}/);
});
test('In-flight actions prevent dismissal and duplicate keyboard/pointer commands',()=>{
 assert.match(bar,/canDismiss=\{\(\) => !presenceRequestGateRef\.current\.isMutating\(\) && !accountUtilityInvocationRef\.current\.isExecuting\(\)\}/);
 assert.match(bar,/disabled=\{accountUtilityBusy\} onClick=\{\(\) => invokeAccountUtility/);
 assert.match(bar,/accountUtilityInvocationRef\.current\.isExecuting\(\)\) return;/);
});
test('Failure text has proper CSS ownership, mobile column span and legible light color',()=>{
 assert.match(css,/\.taskbar-account-utility-error-v546\{grid-column:1 \/ -1;/);
 assert.match(css,/:root\[data-theme="light"\] \.taskbar-account-utility-error-v546\{color:#9f1239 !important;/);
 assert.match(css,/\.taskbar-account-utility-actions-v546 > button:disabled\{/);
});
test('Detached resource-window copy reports real clipboard failure through shared ActionButton',()=>{
 assert.match(app,/import \{ ClusterActionButton \}/);
 assert.match(app,/<ClusterActionButton variant="quiet" size="compact" action=\{async \(\) => \{/);
 assert.match(app,/if \(!await copyClusterText\(window\.location\.href\)\) throw new Error/);
 assert.match(app,/successLabel="Copied" errorLabel="Copy failed"/);
 assert.doesNotMatch(app,/onClick=\{\(\) => void copyClusterText\(window\.location\.href\)\}/);
});
test('Native server list is focusable and keyboard-operable, not mouse-only',()=>{
 assert.match(profiles,/delegate: ItemDelegate \{\s*id: profileRow/);
 assert.match(profiles,/activeFocusOnTab: true\s*Accessible\.role: Accessible\.ListItem/);
 assert.match(profiles,/Accessible\.selected: root\.selectedProfileId/);
 assert.match(profiles,/onClicked: root\.selectProfile\(modelData\.id\)/);
 assert.doesNotMatch(profiles,/MouseArea\s*\{/);
 assert.match(profiles,/border\.color: profileRow\.activeFocus \? Theme\.focusRing/);
});
test('Native destructive buttons demand explicit confirmation and preserve server errors',()=>{
 assert.equal((profiles.match(/onClicked: resetDialog\.confirmFor\(detailPane\.profile\)/g)||[]).length,2);
 assert.match(profiles,/onClicked:\s*\{\s*forgetDialog\.confirmFor\(detailPane\.profile\)/);
 assert.equal((profiles.match(/standardButtons: Dialog\.Cancel \| Dialog\.Ok/g)||[]).length,2);
 assert.match(profiles,/if \(targetProfileId\.length && !clusterApp\.serverProfiles\.resetProfileData\(targetProfileId\)\)/);
 assert.match(profiles,/if \(targetProfileId\.length && clusterApp\.serverProfiles\.forgetProfile\(targetProfileId\)\)/);
 assert.match(store,/bool ServerProfileStore::resetProfileData/);
});
test('Native Save & switch reports activation failure without duplicating saved profile',()=>{
 assert.match(profiles,/if \(!clusterApp\.serverProfiles\.switchProfile\(String\(result\.id\)\)\)/);
 assert.match(profiles,/root\.selectProfile\(result\.id\)[\s\S]*?root\.formError = clusterApp\.serverProfiles\.lastOperationError/);
});
test('Reduced transparency and high-contrast surfaces both use opaque materials',()=>{
 assert.match(surface,/\(Theme\.highContrast \|\| Theme\.reducedTransparency\) \? Theme\.opaqueSurface/);
 assert.match(surface,/gradient: Theme\.reducedTransparency \|\| Theme\.highContrast \? null/);
 assert.match(theme,/readonly property color opaqueSurface:/);
});
let passed=0;
for(const [name,check] of tests){try{await check();passed++;console.log('PASS',name);}catch(e){console.error('FAIL',name,e.message);process.exitCode=1;}}
console.log(`TD3 return-to-phase source and behavior tests: ${passed}/${tests.length} passed`);
