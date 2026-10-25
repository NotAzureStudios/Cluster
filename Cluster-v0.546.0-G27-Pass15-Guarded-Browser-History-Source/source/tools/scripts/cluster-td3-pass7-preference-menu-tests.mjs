import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const files = {
 visual: read('packages/renderer/src/core/visual-system.ts'),
 model: read('packages/renderer/src/features/application/application-models/settings-server.ts'),
 server: read('apps/server/src/domains/users/user-preference-routes.ts'),
 state: read('packages/renderer/src/features/application/modules/application-foundation.tsx'),
 settings: read('packages/renderer/src/features/settings/AccountSettingsPage.tsx'),
 preview: read('packages/renderer/src/features/settings/AppearanceShellPreview.tsx'),
 shell: read('packages/renderer/src/features/shell/shell-v2.css'),
 menu: read('packages/renderer/src/components/ClusterContextActions.tsx'),
 context: read('packages/renderer/src/components/ClusterContextMenu.tsx'),
 navigation: read('packages/renderer/src/components/cluster-menu-navigation.ts'),
};
let checks=0;
function test(description, predicate){assert.ok(predicate,description);checks++;console.log('PASS',description);}
for (const key of ['iconSize','panelBorders','scrollbarStyle']) {
 test(`${key}: input, resolver, and context`, ['VisualSettingsInput','EffectiveVisualContext'].every(name=>files.visual.includes(name)) && files.visual.includes(`instance.${key}`));
 test(`${key}: preference model, server, and stored preferences`, [files.model,files.server,files.state].every(s=>s.includes(key)));
 test(`${key}: user controls and reset`, files.settings.includes(`patch("${key}"`) && files.settings.includes(`${key}: `));
 test(`${key}: resolved visual preview`,files.preview.includes(`context.${key}`));
 test(`${key}: root projection`,files.visual.includes(`root.dataset.${key} =`));
}
test('icon scales artwork, not button dimensions', files.shell.includes('scale: var(--cluster-icon-scale, 1)') && !files.shell.includes('min-height: calc(var(--cluster-icon-scale'));
test('high contrast forces prominent scrollbar and defined borders', files.visual.includes('context.accessibility.highContrast ? "prominent" : context.scrollbarStyle') && files.visual.includes('context.accessibility.highContrast ? "defined" : context.panelBorders'));
test('no hidden scrollbar option or scrollbar-width none added',!files.server.includes('scrollbarStyle: z.enum(["none"') && !/data-scrollbar-style="minimal"[^\n]+scrollbar-width:\s*none/.test(files.shell));
const nav = ['appearance-theme-v546','appearance-materials-v546','appearance-layout-v546','appearance-motion-v546','appearance-presets-v546'];
const navDoc = files.settings.slice(files.settings.indexOf('<div className="settings-section-v092 appearance-section-v092">'),files.settings.indexOf('{section === "navigation"'));
const positions = nav.map(id => navDoc.lastIndexOf(`id="${id}"`));
test('appearance headings occur in category-nav order',positions.every((n,i)=>n>=0 && (i===0 || n>positions[i-1])));
test('menu uses shared keyboard navigation helper', files.menu.includes('focusMenuItem(menuRef.current, event.key)') && !files.menu.includes('function moveFocus'));
test('context and overflow use same destructive action separator helper', [files.menu,files.context].every(s=>s.includes('actionMenuSeparatorBefore(items, index)')));
test('destructive separators avoid duplicates and leading separators', files.navigation.includes('index <= 0') && files.navigation.includes('items[index].danger === true && items[index - 1].danger !== true'));
console.log(`${checks}/${checks} TD3 Pass 7 preferences and menu source assertions passed`);
