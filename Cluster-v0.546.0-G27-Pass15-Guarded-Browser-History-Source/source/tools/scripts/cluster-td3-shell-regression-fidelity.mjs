import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = p => fs.readFileSync(join(root,p),'utf8');
const taskbar=read('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
const tabs=read('packages/renderer/src/features/shell/TaskbarProjectTabs.tsx');
const transfer=read('packages/renderer/src/features/shell/TaskbarTransferCenter.tsx');
const avatar=read('packages/renderer/src/components/PresenceAvatar.tsx');
const presence=read('packages/renderer/src/styles/components/presence-avatar.css');
const fixture=read('tools/fixtures/td3-pass7-workspace.html');
const previews=read('tools/scripts/cluster-td3-pass11-previews.py');
const search=read('packages/renderer/src/features/search/search.css');
const cases = [
  ['real taskbar mounts My Work',()=>assert.match(taskbar,/canSeeMyWork && \([\s\S]*?onClick=\{onOpenMyWork\}/)],
  ['real taskbar mounts Tickets',()=>assert.match(taskbar,/canSeeTickets && \([\s\S]*?cluster-taskbar-action--icon tickets/)],
  ['real taskbar mounts Transfer Center',()=>assert.match(taskbar,/<TaskbarTransferCenter\s*\/>/)],
  ['Transfer Center includes browser downloads',()=>assert.match(transfer,/browserDownloads\.map/)],
  ['real taskbar mounts one search trigger',()=>assert.equal((taskbar.match(/className="cluster-taskbar-action cluster-taskbar-command"/g)||[]).length,1)],
  ['taskbar tab component only maps project objects',()=>{assert.match(tabs,/openProjectIds\.map/);assert.doesNotMatch(tabs,/onOpenPeople\(/);}],
  ['People avatar has identity color data',()=>assert.match(avatar,/--user-avatar-accent/)],
  ['People avatar includes separate presence indicator',()=>assert.match(avatar,/cluster-presence-indicator-v227/)],
  ['shared avatar uses non-round People styling',()=>assert.match(read('packages/renderer/src/features/application/admin-control-center.css'),/\.cluster-presence-avatar-v227 \{ border-radius: 9px; \}/)],
  ['preview keeps My Work',()=>assert.match(fixture,/aria-label="My Work"/)],
  ['preview keeps Tickets',()=>assert.match(fixture,/aria-label="Tickets"/)],
  ['preview keeps Transfer Center',()=>assert.match(fixture,/aria-label="Transfer Center"/)],
  ['preview has one search control, not a button and fake search bar',()=>assert.equal((fixture.match(/aria-label="Search Cluster"/g)||[]).length,1)],
  ['preview taskbar has project tabs by default',()=>{assert.match(fixture,/<div class="td5-tab">.*Project Atlas/);assert.doesNotMatch(fixture,/<div class="td5-tab">.*People/);}],
  ['preview generator no longer substitutes current workspace for project tabs',()=>assert.doesNotMatch(previews,/tab\.innerHTML=/)],
  ['preview People avatar includes colored border and dot',()=>{assert.match(previews,/border:2px solid var\(--td-avatar-color\)/);assert.match(previews,/\.td11-avatar::after/);}],
  ['real user border retained',()=>assert.match(presence,/--user-avatar-accent/)],
  ['real search background and focus present',()=>{assert.match(search,/search-command-input-v294:focus-within/);assert.match(search,/background: color-mix\(in srgb, var\(--panel\)/);}],
];
for(const [label, check] of cases){check();console.log(`PASS ${label}`)}
console.log(`PASS ${cases.length}/${cases.length} shell/preview regression assertions`);
