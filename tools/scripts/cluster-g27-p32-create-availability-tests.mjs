import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const drawer=readFileSync(path.join(root,'packages/renderer/src/features/create/SharedCreateDrawer.tsx'),'utf8');
const access=readFileSync(path.join(root,'packages/renderer/src/features/create/create-mode-access.ts'),'utf8');
let checks=0;function check(name,fn){fn();checks++;console.log('PASS',name)}
check('recent Create mode choices are keyed to signed-in account',()=>assert.match(drawer,/localStorage\.getItem\(`cluster\.recent-create-modes:\$\{currentUser\.id\}`\)/));
check('recent Create mode writes cannot cross account',()=>assert.match(drawer,/localStorage\.setItem\(`cluster\.recent-create-modes:\$\{currentUser\.id\}`, JSON\.stringify\(next\)\)/));
check('unscoped historic Create modes are not imported as a fallback',()=>assert.doesNotMatch(drawer,/localStorage\.getItem\("cluster\.recent-create-modes"\)/));
check('Create uses shared permission and Studio availability authority',()=>{assert.match(drawer,/canOfferMode\(currentUser, settings, candidate\)/); assert.match(readFileSync(new URL('../../packages/renderer/src/features/create/create-mode-access.ts',import.meta.url),'utf8'),/if \(!canUseTool\(user, TOOL_BY_CREATE_MODE\[mode\], mode === \"project\" \? \"manage\" : \"edit\"\)\) return false/);});
check('Project creation requires manage rather than view',()=>assert.match(access,/mode === "project" \? "manage" : "edit"/));
for(const [name,needle] of Object.entries({timeline:'timelineEnabled',ticket:'ticketsEnabled',calendar:'calendarEnabled',scheduler:'schedulerEnabled',packet:'packetsEnabled'})){
 check(`disabled ${name} never offered`,()=>assert.match(access,new RegExp(`mode === "${name}"[\\s\\S]{0,100}settings\\?\\.${needle} === false`)));
}
check('unavailable modes excluded from available picker groups',()=>assert.match(drawer,/const item = availableModes\.find\(\(candidate\) => candidate\.id === modeId\)/));
check('unavailable past choices excluded from Recent',()=>assert.match(drawer,/recentCreateModes\.map\(\(modeId\) => availableModes\.find/));
check('Picker totals reflect only offered modes',()=>assert.match(drawer,/modes=\{availableModes\}/));
check('specialized-mode count excludes disabled and inaccessible modes',()=>assert.match(drawer,/specializedModeCount=\{CREATE_SPECIALIZED_MODE_IDS\.filter/));
check('unavailable handoff defaults reopen permission-filtered picker',()=>assert.match(drawer,/setShowModePicker\(!handoff\?\.mode \|\| !canOfferCreateMode\(nextMode\)\)/));
check('Create mode change is guarded before changing selection',()=>assert.match(drawer,/function changeCreateMode\(nextMode: QuickCreateMode\) \{\s+if \(!canOfferCreateMode\(nextMode\)\)/));
check('Create execution rechecks current access and tool settings',()=>assert.match(drawer,/async function submitSharedCreate\([^)]*\) \{\s+if \(!canOfferCreateMode\(mode\)\)/));
check('all canonical 11 Create types have explicit tool owner',()=>{for(const name of ['project','card','ticket','bug','build','timeline','calendar','scheduler','meeting','whiteboard','packet'])assert.match(access,new RegExp(`\\b${name}: "`));});
console.log(`G27 P32 Create availability: ${checks}/${checks} passed`);
