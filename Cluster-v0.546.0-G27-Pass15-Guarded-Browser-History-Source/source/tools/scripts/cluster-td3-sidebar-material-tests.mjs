import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../../', import.meta.url);
const read=(rel)=>readFileSync(new URL(rel,root),'utf8');
const context=read('packages/renderer/src/core/visual-system.ts');
const server=read('apps/server/src/domains/users/user-preference-routes.ts');
const models=read('packages/renderer/src/features/application/application-models/settings-server.ts');
const state=read('packages/renderer/src/features/application/modules/application-foundation.tsx');
const settings=read('packages/renderer/src/features/settings/AccountSettingsPage.tsx');
const preview=read('packages/renderer/src/features/settings/AppearanceShellPreview.tsx');
const shell=read('packages/renderer/src/features/shell/shell-v2.css');
const style=read('packages/renderer/src/features/settings/settings-workspace.css');
const checks=[
 ['layout typed in canonical visual settings',()=>assert.match(context,/sidebarLayout\?: VisualSidebarLayout/)],
 ['docked defaults preserve prior chrome',()=>assert.match(context,/sidebarLayout: "docked"/)],
 ['surface depth resolved',()=>assert.match(context,/choice\(instance\.surfaceDepth/)],
 ['texture choice resolved',()=>assert.match(context,/choice\(instance\.surfaceTexture/)],
 ['texture intensity bounded',()=>assert.match(context,/clamp\(instance\.surfaceTextureIntensity, 0, 20/)],
 ['user preferences validated by server',()=>assert.match(server,/sidebarLayout: z\.enum\(\["docked", "floating"\]\)/)],
 ['texture slider server validated',()=>assert.match(server,/surfaceTextureIntensity: z\.number\(\)\.int\(\)\.min\(0\)\.max\(20\)/)],
 ['type model includes new choices',()=>assert.match(models,/surfaceDepth\?: "flat" \| "soft" \| "elevated"/)],
 ['preferences persist alongside taskbar',()=>assert.match(state,/"taskbarLayout", "sidebarLayout", "surfaceDepth", "surfaceTexture", "surfaceTextureIntensity"/)],
 ['sidebar radio selection accessible',()=>assert.match(settings,/aria-label="Sidebar layout"/)],
 ['surface texture radio selection accessible',()=>assert.match(settings,/aria-label="Surface texture"/)],
 ['appearance section navigation grouped',()=>assert.match(settings,/aria-label="Appearance categories"/)],
 ['immediate unsaved preview uses choices',()=>assert.match(preview,/data-sidebar-layout=\{context\.sidebarLayout\}/)],
 ['root gets sidebar layout',()=>assert.match(context,/root\.dataset\.sidebarLayout = context\.sidebarLayout/)],
 ['floating layout applied to existing shell',()=>assert.match(shell,/\[data-sidebar-layout="floating"\] \.app-shell\.shell-unified-v3430/)],
 ['mobile keeps drawer and prevents floating override',()=>assert.match(shell,/@media \(max-width: 899px\)/)],
 ['high contrast suppresses decorative texture',()=>assert.match(shell,/:root\[data-high-contrast="true"\], :root\[data-surface-style="flat"\]/)],
 ['live preview mirrors floating silhouette',()=>assert.match(style,/data-sidebar-layout="floating"/)],
 ['only one taskbar component retained',()=>assert.ok(!shell.includes('data-sidebar-layout="floating"] .taskbar-unified-v3430{display:none'))],
];
checks.forEach(([name,fn])=>{fn(); console.log('PASS',name)});
console.log(`${checks.length}/${checks.length} TD3 Pass 6 source contract checks passed`);
