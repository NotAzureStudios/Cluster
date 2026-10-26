/** TD3 Pass 16: source contracts for shared disclosure + menu convergence. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = path => readFileSync(resolve(root,path),'utf8');
let count=0;
function check(name,fn){fn();count++;console.log(`PASS ${name}`);}
const shared=read('packages/renderer/src/components/ClusterDisclosureGroup.tsx');
check('one native details disclosure remains in shared owner',()=>assert.match(shared,/<details[\s\S]+?<summary/));
check('shared header retains one accessible content reference',()=>assert.match(shared,/aria-controls=\{contentId\}/));
check('shared header supports trailing dynamic counts',()=>assert.match(shared,/headerTrailing\?: ReactNode/));
check('controlled disclosures only emit true transitions',()=>assert.match(shared,/next !== expanded/));
check('disclosure ignores disabled pointer/keyboard activation',()=>assert.match(shared,/if \(disabled\) event\.preventDefault\(\)/));
for(const [label,file,countExpected] of [
 ['People filters','packages/renderer/src/features/application/modules/application-team-workspace.tsx',1],
 ['Boards','packages/renderer/src/features/boards/BoardWorkspacePage.tsx',1],
 ['Whiteboards','packages/renderer/src/features/whiteboards/WhiteboardWorkspacePanels.tsx',2],
 ['Project history and relationships','packages/renderer/src/features/projects/ProjectMetadataPanels.tsx',2],
 ['Library metadata','packages/renderer/src/features/library/LibraryWorkspacePage.tsx',1]
]){
 check(`${label} uses shared disclosures with retained content`,()=>{
  const text=read(file); assert.equal((text.match(/<ClusterDisclosureGroup\b/g)||[]).length>=countExpected,true);
  assert.match(text,/import \{ ClusterDisclosureGroup \}/);
 });
}
check('Board related-record and collaboration content preserved',()=>{
 const src=read('packages/renderer/src/features/boards/BoardWorkspacePage.tsx');assert.match(src,/title="Relationships, fields & history"/);assert.match(src,/<VersionHistoryPanel/);assert.match(src,/<CollaborationPanel/);
});
check('Whiteboard restore and activity controls preserved',()=>{
 const src=read('packages/renderer/src/features/whiteboards/WhiteboardWorkspacePanels.tsx');for(const c of ['captureSnapshot','restoreSnapshot','<SharedWorkEvidencePanel','<SharedWorkActivityPanel']) assert.ok(src.includes(c),c);
});
check('Project snapshot destructive confirmation retained',()=>assert.match(read('packages/renderer/src/features/projects/ProjectMetadataPanels.tsx'),/await confirmCluster\(\{ title: "Delete snapshot history\?"/));
check('Library metadata retains the JSON field editing state',()=>assert.match(read('packages/renderer/src/features/library/LibraryWorkspacePage.tsx'),/title="Custom metadata"[\s\S]*?value=\{draft\.metadata\}/));
const nav=read('packages/renderer/src/components/CompactSectionNav.tsx');
const sw=read('packages/renderer/src/components/ProjectResourceSwitcher.tsx');
const hook=read('packages/renderer/src/components/useClusterInlineMenu.ts');
check('shared inline dismissal closes only the owning details ref',()=>{assert.match(hook,/const element = detailsRef\.current/);assert.doesNotMatch(nav,/document\.querySelectorAll<HTMLDetailsElement>/);});
check('shared inline dismissal closes on outside pointer events',()=>assert.match(hook,/document\.addEventListener\("pointerdown", outside, true\)/));
check('shared inline dismissal cleans up document listener',()=>assert.match(hook,/document\.removeEventListener\("pointerdown", outside, true\)/));
check('Escape restores summary focus',()=>{assert.match(hook,/event\.key !== "Escape"/);assert.match(hook,/dismiss\(true\)/);});
check('section nav exposes menu radio selection and arrow keyboard controls',()=>{assert.match(nav,/role="menuitemradio"/);assert.match(nav,/event\.key === "ArrowDown"/);});
check('resource browsing closes its own menu on selection',()=>assert.match(sw,/onChange\(item\.id\); dismiss\(\)/));
check('Team filter CSS keeps a single header and separate responsive grid',()=>{const css=read('packages/renderer/src/features/application/styles/team-workspace.css');assert.match(css,/details\.team-command-bar-v062\.cluster-field-v425/);assert.match(css,/> \.team-filter-grid-v0102/);});
check('shared disclosures retain focus-visible styles',()=>assert.match(read('packages/renderer/src/styles/design-system/primitives.css'),/details\.cluster-field-v425 > summary:focus-visible/));
check('Qt settings can be resized below old 520px constraint',()=>assert.match(read('apps/desktop-qt/qml/pages/AppSettingsWindow.qml'),/minimumWidth: 360/));
check('taskbar still has Tickets, My Work, transfers',()=>{const s=read('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');for(const c of ['TaskbarTransferCenter','canSeeMyWork','canSeeTickets'])assert.ok(s.includes(c));});
check('project-only tab search transition still present',()=>assert.match(read('packages/renderer/src/features/shell/ShellPrimitives.tsx'),/cluster-taskbar-search-switch/));
check('People identity retains independent user color and presence',()=>{const s=read('packages/renderer/src/components/PresenceAvatar.tsx');assert.match(s,/--user-avatar-accent/);assert.match(s,/cluster-presence-indicator-v227/);});
console.log(`${count}/${count} TD3 Pass 16 tests passed`);
