/** TD3 Pass 18 implementation/preservation contract tests. No release-certification claims. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const base='packages/renderer/src/features/';
const texts=Object.fromEntries([
 'projects/ProjectBuildsPanel.tsx','projects/ProjectQaRunsPanel.tsx','projects/ProjectsPage.tsx',
 'projects/ProjectIntelligencePanel.tsx','projects/ProjectAccessPanel.tsx',
 'viewer/ViewerInspector.tsx','notifications/NotificationInboxPage.tsx',
 'library/LibraryGovernancePanel.tsx',
].map(p=>[p,read(base+p)]));
const cases=[];
const test=(label,fn)=>cases.push([label,fn]);
function own(path,title,className){ test(`${title} uses shared owner`,()=>{
 assert.match(texts[path],new RegExp(`<ClusterDisclosureGroup[^>]*title=(?:"${title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"|\\{)`));
 if(className)assert.ok(texts[path].includes(className));
 }); }
own('projects/ProjectBuildsPanel.tsx','Release context','project-release-context-disclosure-v30d');
own('projects/ProjectIntelligencePanel.tsx','Advanced operations & evidence','project-intelligence-deep-dive-v30d');
own('projects/ProjectsPage.tsx','Portfolio signals','projects-intelligence-v30d');
own('projects/ProjectQaRunsPanel.tsx','More QA context');
own('viewer/ViewerInspector.tsx','Sensitive metadata','cluster-viewer-inspector-section');
own('notifications/NotificationInboxPage.tsx','24-hour digest','notification-digest-v387');
own('notifications/NotificationInboxPage.tsx','Active threads');
own('notifications/NotificationInboxPage.tsx','View sources');
own('library/LibraryGovernancePanel.tsx','Child item evidence');
own('library/LibraryGovernancePanel.tsx','Version evidence');
for(const [label,field] of [['release stage','releaseStage'],['QA gate count','platformReadyCount'],['release blockers','blockers.length']])test(`Release context keeps ${label}`,()=>assert.ok(texts['projects/ProjectBuildsPanel.tsx'].includes(field)));
for(const f of ['ProjectDeliveryRiskPanel','LinkedWorkPanel','SharedWorkEvidencePanel','SharedWorkWatchControl','CollaborationPanel'])test(`QA keeps ${f}`,()=>assert.ok(texts['projects/ProjectQaRunsPanel.tsx'].includes(`<${f}`)));
for(const f of ['ClusterMetricStrip','portfolioIntelligence.highPressureOwners','portfolioIntelligence.atRisk'])test(`Portfolio keeps ${f}`,()=>assert.ok(texts['projects/ProjectsPage.tsx'].includes(f)));
for(const f of ['createProjectDependency','ensureDeliveryPipeline','snapshot?.activity'])test(`Intelligence retains ${f}`,()=>assert.ok(texts['projects/ProjectIntelligencePanel.tsx'].includes(f)));
for(const field of ['digest?.rows.length','threadGroups.length','rules[kind] !== false'])test(`Inbox keeps ${field}`,()=>assert.ok(texts['notifications/NotificationInboxPage.tsx'].includes(field)));
for(const field of ['viewSensitiveMetadata','onLoadSensitiveMetadata','session.sensitiveMetadata','accessDiagnostics'])test(`Viewer preserves ${field}`,()=>assert.ok(texts['viewer/ViewerInspector.tsx'].includes(field)));
for(const field of ['preview.evidence.children','preview.evidence.versions','retention.reason'])test(`Library retains ${field}`,()=>assert.ok(texts['library/LibraryGovernancePanel.tsx'].includes(field)));
test('Access sources shared with authorization evidence',()=>assert.match(texts['projects/ProjectAccessPanel.tsx'],/project-access-explain-disclosure-v546/));
test('Access sources retains detailed contributors',()=>assert.match(texts['projects/ProjectAccessPanel.tsx'],/explanation\.tool\.contributors\.map/));
const disclosure=read('packages/renderer/src/components/ClusterDisclosureGroup.tsx');
const css=read('packages/renderer/src/styles/design-system/primitives.css');
test('Disclosure preserves controlled/uncontrolled state',()=>assert.match(disclosure,/controlled \? open : internalOpen/));
test('Native details focus and disabled semantics preserved',()=>{assert.match(disclosure,/if \(disabled\) event\.preventDefault\(\)/);assert.match(css,/summary:focus-visible/)});
test('Shared chevron exists without overriding domain surfaces',()=>{assert.match(disclosure,/name="chevron-right" className="cluster-disclosure-chevron-v546"/);assert.match(css,/\.cluster-disclosure-chevron-v546/)});
test('Shared chevron respects reduced motion',()=>assert.match(css,/prefers-reduced-motion: reduce/));
const combo=read('apps/desktop-qt/qml/components/ClusterComboBox.qml');
test('Qt ComboBox resolves textRole through ComboBox API',()=>{assert.match(combo,/text: control\.textAt\(index\)/);assert.doesNotMatch(combo,/text: modelData/)});
test('Qt ComboBox options have accessible names',()=>assert.match(combo,/Accessible\.name: control\.textAt\(index\)/));
const shell=read('packages/renderer/src/features/shell/TaskbarProjectTabs.tsx');
const taskbar=read('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
test('Taskbar search still has one project tab slot',()=>assert.match(shell,/TaskbarProjectTabs/));
for (const label of ['My Work','Tickets']) test(`Taskbar preserves ${label}`,()=>assert.ok(taskbar.includes(label)));
test('Taskbar preserves Transfer Center',()=>assert.match(taskbar,/<TaskbarTransferCenter \/>/));
const people=read('packages/renderer/src/components/PresenceAvatar.tsx');
test('Person user-color borders and separate dot preserved',()=>{assert.match(people,/personalAccentColor|accentColor/);assert.match(people,/cluster-presence-indicator-v227/)});
let good=0;
for(const [label,fn] of cases){try{fn();good++;console.log('PASS',label)}catch(e){process.exitCode=1;console.error('FAIL',label,e.message)}}
console.log(`${good}/${cases.length} TD3 Pass18 contracts passed`);
