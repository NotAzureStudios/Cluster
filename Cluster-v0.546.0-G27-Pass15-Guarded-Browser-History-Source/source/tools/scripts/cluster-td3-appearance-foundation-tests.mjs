import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch {
  return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js'));
} })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const palette = JSON.parse(read('packages/shared/appearance/semantic-palette.json'));
function loadTs(file, dependencies) {
  const code = ts.transpileModule(read(file), { fileName: file, compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true} }).outputText;
  const module = {exports:{}};
  vm.runInNewContext(code, {module, exports: module.exports, require: name => {
    if (name.endsWith('semantic-palette.json')) return palette;
    const dep = Object.keys(dependencies).find(k => name.endsWith(k));
    if (dep) return dependencies[dep];
    throw Error(`Unexpected import: ${name}`);
  }, console}, {filename:file});
  return module.exports;
}
const accessibility = loadTs('packages/renderer/src/core/accessibility-preferences.ts', {});
const visual = loadTs('packages/renderer/src/core/visual-system.ts', {'accessibility-preferences':accessibility});
const createRoot = (mode = 'dark') => {
  const values = new Map();
  return {dataset:{theme:mode}, style:{setProperty:(key,value)=> values.set(key,value),getPropertyValue:key=>values.get(key)}, values};
};
const system = {reducedMotion:false,highContrast:false,reducedTransparency:false};
let count = 0;
function check(name, cb) { cb(); count++; console.log(`PASS ${name}`); }
const master = visual.CLUSTER_VISUAL_MASTER;
check('master preserves Comfortaa and compact density', () => {assert.equal(master.fontFamily,'comfortaa');assert.equal(master.interfaceDensity,'compact')});
check('master-only instance is a fresh copy', () => { const value=visual.resolveVisualInstance(master);assert.notStrictEqual(value,master);assert.equal(value.fontFamily,'comfortaa'); });
check('three level inheritance applies parent then child', () => {
  const resolved=visual.resolveVisualInstance(master,
    {id:'device',parentId:'user',overrides:{glassStrength:30}},
    {id:'studio',parentId:'cluster-visual-master',overrides:{studioPrimaryColor:'#123456',fontFamily:'inter'}},
    {id:'user',parentId:'studio',overrides:{fontFamily:'mono',cornerRadius:19}},
    {id:'final',parentId:'device',overrides:{fontFamily:'system'}});
  assert.equal(resolved.studioPrimaryColor,'#123456');assert.equal(resolved.fontFamily,'system');assert.equal(resolved.cornerRadius,19);assert.equal(resolved.glassStrength,30);
});
check('unrelated sibling values do not leak into selected chain', () => {
 const actual=visual.resolveVisualInstance(master,{id:'user',overrides:{fontFamily:'mono'}},{id:'device',parentId:'cluster-visual-master',overrides:{cornerRadius:13}});
 assert.equal(actual.fontFamily,'comfortaa'); assert.equal(actual.cornerRadius,13);
});
check('out of order parent is resolved',()=>assert.equal(visual.resolveVisualInstance(master,{id:'child',parentId:'parent',overrides:{cornerRadius:3}},{id:'parent',overrides:{cornerRadius:14}},{id:'leaf',parentId:'child',overrides:{}}).cornerRadius,3));
check('unknown parent is rejected',()=>assert.throws(()=>visual.resolveVisualInstance(master,{id:'child',parentId:'absent',overrides:{}}),/Unknown visual instance parent/));
check('two-node cycle is rejected',()=>assert.throws(()=>visual.resolveVisualInstance(master,{id:'a',parentId:'b',overrides:{}},{id:'b',parentId:'a',overrides:{}}),/cycle/));
check('self-cycle is rejected',()=>assert.throws(()=>visual.resolveVisualInstance(master,{id:'a',parentId:'a',overrides:{}}),/cycle/));
check('duplicate IDs are rejected',()=>assert.throws(()=>visual.resolveVisualInstance(master,{id:'a',overrides:{}},{id:'a',overrides:{}}),/Duplicate/));
check('reserved master ID is rejected',()=>assert.throws(()=>visual.resolveVisualInstance(master,{id:'cluster-visual-master',overrides:{}}),/reserved/));
check('unbounded instance graphs are rejected',()=>assert.throws(()=>visual.resolveVisualInstance(master,...Array.from({length:33},(_,i)=>({id:'a'+i,overrides:{}}))),/32 layers/));
check('legacy grid fallback overrides master default',()=> {const x=visual.resolveVisualContext({backgroundStyle:'grid'},undefined,system);assert.equal(x.backgroundPattern,'grid');assert.equal(x.backgroundBase,'clean');});
check('no-transparency changes glass to outlined and solid',()=> {const x=visual.resolveVisualContext({surfaceStyle:'glass',sidebarSurface:'glass',taskbarSurface:'glass',userTransparencyPreference:'off'},undefined,system);assert.equal(x.surfaceStyle,'outlined');assert.equal(x.sidebarSurface,'solid');assert.equal(x.taskbarSurface,'solid')});
check('reduced motion obeys operating system floor',()=> {const x=visual.resolveVisualContext({userMotionPreference:'full'},undefined,{...system,reducedMotion:true});assert.equal(x.accessibility.motion,'reduced')});
check('color contrast chooses correct candidate',()=> {assert.equal(visual.themeContrastColor('#57c1ff'),'#07111f');assert.equal(visual.themeContrastColor('#010102'),'#ffffff')});
check('canonical semantic palette has matching modes and CSS colors',()=> {const names=Object.keys(palette.dark);assert.deepEqual(Object.keys(palette.light),names);assert.ok(names.length>=15);for(const mode of ['dark','light'])for(const v of Object.values(palette[mode]))assert.match(v,/^#(?:[0-9A-F]{6}|[0-9A-F]{8})$/i)});
const lum=hex=>{const h=hex.slice(1,7);const rgb=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
const contrast=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)};
check('semantic primary text contrast passes WCAG AA in both themes',()=>{for(const mode of ['dark','light'])assert.ok(contrast(palette[mode].text,palette[mode].background)>=4.5,mode)});
check('semantic muted text contrast passes WCAG AA against background',()=>{for(const mode of ['dark','light'])assert.ok(contrast(palette[mode].textMuted,palette[mode].background)>=4.5,mode)});
check('semantic high contrast border and muted text honor mode',()=>{assert.equal(visual.resolveSemanticPalette('dark',true).border,'#FFFFFF');assert.equal(visual.resolveSemanticPalette('light',true).borderStrong,'#000000');assert.equal(visual.resolveSemanticPalette('light',true).textMuted,palette.light.text)});
check('semantic CSS variables match chosen theme exactly',()=>{for(const mode of ['dark','light']){const root=createRoot(mode);visual.applySemanticPalette(root,mode);assert.equal(root.values.get('--cluster-semantic-background'),palette[mode].background);assert.equal(root.values.get('--cluster-semantic-surface-strong'),palette[mode].surfaceStrong);assert.equal(root.values.get('--cluster-semantic-text-muted'),palette[mode].textMuted)}});
check('visual application publishes semantically resolved CSS and datasets',()=>{const root=createRoot('light');const ctx=visual.resolveVisualContext({fontFamily:'inter',userContrastPreference:'high'},null,system);visual.applyVisualContext(root,ctx);assert.equal(root.values.get('--cluster-semantic-border'),'#111827');assert.equal(root.dataset.font,'inter');assert.equal(root.dataset.highContrast,'true');assert.equal(root.values.get('--studio-primary'),ctx.studioPrimary)});
check('generated Qt singleton is registered in native module',()=>{const cm=read('apps/desktop-qt/CMakeLists.txt');assert.match(cm,/qml\/ThemeTokens\.qml/);assert.match(read('apps/desktop-qt/qml/ThemeTokens.qml'),/pragma Singleton/)});
check('every native color consumes generated semantic tokens',()=>{const qml=read('apps/desktop-qt/qml/Theme.qml');for(const key of Object.keys(palette.dark))assert.match(qml,new RegExp(`ThemeTokens\\.${key}Dark`),`Qt missing ${key}`)});
check('native and Web do not diverge on text, surface and background names',()=>{assert.match(read('packages/renderer/src/core/visual-system.ts'),/applySemanticPalette\(root/);assert.match(read('packages/renderer/src/features/application/modules/application-shell-runtime.ts'),/applySemanticPalette\(document\.documentElement, resolved/)});
check('CSS provides focus and reduced motion behavior to the appearance preview',()=>{const css=read('packages/renderer/src/styles/visual-system.css');assert.match(css,/--cluster-focus-outline-width/);assert.match(css,/:focus-visible/);assert.match(css,/prefers-reduced-motion: reduce/);assert.match(css, /data-motion="none"/)});
check('focus ring meets non-text 3:1 contrast against both backgrounds',()=>{
 for(const mode of ['dark','light']) {
  assert.ok(contrast(palette[mode].focusRing,palette[mode].background)>=3,`${mode} background`);
  assert.ok(contrast(palette[mode].focusRing,palette[mode].backgroundDeep)>=3,`${mode} background deep`);
 }
});
check('generated Qt colors exactly match Web palette including ARGB alpha conversion',()=>{
 const qml=read('apps/desktop-qt/qml/ThemeTokens.qml');
 for(const mode of ['dark','light'])for(const [key,css] of Object.entries(palette[mode])){
  const qt=css.length===9?`#${css.slice(7)}${css.slice(1,7)}`:css;
  assert.ok(qml.includes(`readonly property color ${key}${mode==='dark'?'Dark':'Light'}: "${qt.toUpperCase()}"`),`${mode}.${key}`);
 }
});
check('Qt focus colors use shared accessible focus token, including high-contrast handling',()=>{
 const theme=read('apps/desktop-qt/qml/Theme.qml');assert.match(theme,/property color focusRing: highContrast/);
 for(const name of ['ClusterButton','ClusterComboBox','ClusterTextField']){
  const qml=read(`apps/desktop-qt/qml/components/${name}.qml`);
  assert.match(qml,/control\.activeFocus \? Theme\.focusRing/);
 }
});
check('Web toggle focus consumes the same semantic outline contract',()=>{
 assert.match(read('packages/renderer/src/components/cluster-toggle.css'),/var\(--cluster-focus-outline-width/);
});
check('user reduced-motion mode suppresses animations even without an OS media query',()=>{
 assert.match(read('packages/renderer/src/styles/visual-system.css'),/data-motion="reduced"/);
});
check('preview resolves palette using its selected theme rather than only global CSS',()=>{
 const jsx=read('packages/renderer/src/features/settings/AppearanceShellPreview.tsx');
 assert.match(jsx,/resolveSemanticPalette\(resolvedTheme/);
 assert.match(jsx,/style=\{previewStyle\}/);
});
check('changing theme updates semantic variables immediately, including system mode',()=>{
 const root=createRoot('dark');root.dataset.highContrast='false';
 // The compiled module executes in vm without browser globals; give it a real global sandbox.
 const file='packages/renderer/src/features/application/modules/application-shell-runtime.ts';
 const js=ts.transpileModule(read(file),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 vm.runInNewContext(js,{module:mod,exports:mod.exports,document:{documentElement:root},window:{matchMedia:()=>({matches:true})},require:name=>name.includes('privacy-consent')?{readPreferenceStorage:()=>null}:name.includes('visual-system')?visual:{}}, {filename:file});
 mod.exports.applyTheme('light');assert.equal(root.values.get('--cluster-semantic-background'),palette.light.background);
 mod.exports.applyTheme('system');assert.equal(root.values.get('--cluster-semantic-background'),palette.dark.background);
 mod.exports.applyTheme('dark');assert.equal(root.dataset.theme,'dark');
});
check('draft preview owns background pattern, surface and radius independently',()=>{
 const jsx=read('packages/renderer/src/features/settings/AppearanceShellPreview.tsx');
 const css=read('packages/renderer/src/styles/visual-system.css');
 for(const token of ['--cluster-pattern-percent','--cluster-pattern-scale','--cluster-pattern-color','--glass-percent','--radius-lg','--studio-primary'])assert.ok(jsx.includes(token),token);
 for(const dataset of ['data-background-base','data-background-pattern','data-sidebar-surface','data-taskbar-surface','data-surface-style'])assert.ok(jsx.includes(dataset),dataset);
 for(const pattern of ['grid','dots','hex'])assert.ok(css.includes(`.appearance-shell-preview-v10[data-background-pattern="${pattern}"]`),pattern);
 for(const surface of ['glass','solid'])assert.ok(css.includes(`.appearance-shell-preview-v10[data-sidebar-surface="${surface}"]`),surface);
});
console.log(`\n${count}/${count} TD3 appearance foundation tests passed`);
