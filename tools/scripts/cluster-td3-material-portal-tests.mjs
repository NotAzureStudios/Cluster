import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
let count=0;
function check(label,fn){fn();count++;console.log('PASS',label)}
const material=read('packages/renderer/src/styles/visual-system.css');
const shell=read('packages/renderer/src/features/shell/shell-v2.css');
const workspace=read('packages/renderer/src/styles/workspace-contract.css');
const popup=read('packages/renderer/src/components/ClusterFloatingSurface.tsx');
const focus=read('packages/renderer/src/core/dialog-focus.ts');
const modal=read('packages/renderer/src/components/ClusterModal.tsx');
const interaction=read('packages/renderer/src/components/useClusterDialogInteraction.ts');
const accessibility=read('packages/renderer/src/components/AccessibilityManager.tsx');
check('outlined surface has low-strength authored sheen and subtle speckle',()=>{
 assert.match(material,/linear-gradient\(155deg,[\s\S]*?3%, transparent/);
 assert.match(material,/radial-gradient\(circle at 8px 8px,[\s\S]*?2%, transparent/);
 assert.match(material,/\[data-surface-style="outlined"\]/);
});
check('styles use effective Appearance surface state without a new override layer',()=>{
 assert.match(material,/:is\(:root\[data-theme\], \.appearance-shell-preview-v10\[data-theme\]\)\[data-surface-style="outlined"\]/);
 assert.doesNotMatch(read('packages/renderer/src/styles.css'),/td3-material|td3-pass3/i);
});
check('light material uses restrained highlight and shadow',()=>{
 assert.match(material,/--cluster-material-elevation: inset 0 1px 0 rgb\(255 255 255 \/ 72%\)/);
 assert.match(material,/rgb\(30 42 54 \/ 7%\)/);
});
check('flat, high-contrast, forced colors and reduced transparency honor user choice',()=>{
 for(const key of ['data-surface-style="flat"','data-high-contrast="true"','forced-colors: active','data-transparency="off"'])assert.ok(material.includes(key),key);
});
check('legacy light surfaces no longer forcibly suppress appearance material',()=>{
 const block=workspace.match(/:root\[data-theme="light"\] \.panel,\s*:root\[data-theme="light"\] \.management-panel,[\s\S]*?\}/)?.[0];
 assert.ok(block);assert.doesNotMatch(block,/background:[^;]*!important|box-shadow:[^;]*!important/);
});
check('touch shell retains 44px pointer targets for navigation and pin actions',()=>{
 assert.match(shell,/@media \(pointer: coarse\)/);
 assert.match(shell,/min-height: 44px/);
 assert.match(shell,/min-width: 44px/);
});
check('sidebar, project meta, taskbar labels use readable minima',()=>{
 assert.match(shell,/font-size: max\(13px, \.8125rem\)/);
 assert.match(shell,/font-size: max\(12px, \.75rem\)/);
});
check('modal gets stable generated ID, without overriding caller ID',()=>{
 assert.match(modal,/const generatedId = useId\(\)/);
 assert.match(modal,/const modalId = id \|\|/);
 assert.match(modal,/id=\{modalId\}/);
});
check('floating panel identifies modal owner and refuses to close when obscured',()=>{
 assert.match(popup,/data-cluster-modal-owner=\{modalOwnerId\}/);
 assert.match(popup,/topVisibleClusterDialog\(\)/);
 assert.match(popup,/panels\[panels\.length - 1\] !== localRef\.current/);
});
check('Escape closes open owned menu ahead of its modal',()=>{
 assert.match(interaction,/topFloatingForClusterDialog\(topDialog\)/);
 assert.match(interaction,/event\.defaultPrevented/);
});
check('modal keyboard trap sees body-portaled surface',()=>{
 assert.match(focus,/export function topFloatingForClusterDialog/);
 assert.match(focus,/const focusScope = topFloatingForClusterDialog\(dialog\) \|\| dialog/);
 assert.match(focus,/visibleFocusable\(focusScope\)/);
});
check('modal isolation delegates floating surfaces to dynamic owner-aware isolation',()=>{
 assert.match(accessibility,/if \(sibling\.dataset\.clusterFloating === "true"\) continue/);
 assert.match(accessibility,/createFloatingLayerIsolation\(\)/);
 assert.match(accessibility,/floatingIsolation\.sync\(dialog\)/);
 assert.match(accessibility,/window\.clearTimeout\(scheduledDialogFocus\)/);
 assert.match(accessibility,/activeDialog !== dialog/);
});
console.log(`${count}/${count} TD3 material, shell, modal and popup source contracts passed`);
