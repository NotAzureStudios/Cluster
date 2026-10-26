/* TD3 P4 source-contract regression checks. Not runtime certification. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const detail=read('packages/renderer/src/components/ClusterMasterDetail.tsx');
const split=read('packages/renderer/src/components/ClusterResizableSplit.tsx');
const floating=read('packages/renderer/src/components/ClusterFloatingSurface.tsx');
const css=read('packages/renderer/src/styles/design-system/primitives.css');
const material=read('packages/renderer/src/styles/visual-system.css');
const tests=[
 ['inspector portal used only when compact and opened',()=>assert.match(detail,/compact && detailOpen && typeof document !== "undefined" \? createPortal\(/)],
 ['portal target body',()=>assert.match(detail,/<\/div>, document\.body,/)],
 ['mobile dialog has explicit role',()=>assert.match(detail,/role=\{compact && detailOpen \? "dialog"/)],
 ['mobile dialog announces modality',()=>assert.match(detail,/aria-modal=\{compact && detailOpen \? "true"/)],
 ['mobile backdrop only dismisses root clicks',()=>assert.match(detail,/event\.target === event\.currentTarget/)],
 ['mobile dialog interaction Escape and focus restore',()=>assert.match(detail,/useClusterDialogInteraction\(\{ active: compact && detailOpen/)],
 ['cancel stale deferred focus',()=>assert.match(detail,/window\.clearTimeout\(focusTimerRef\.current\)/)],
 ['master-detail has keyboard resize',()=>assert.match(detail,/onKeyDown=\{keyboardResize\}/)],
 ['master-detail supports home/end resizing',()=>assert.match(detail,/event\.key === "Home" \? effectiveMin : event\.key === "End" \? effectiveMax/)],
 ['master-detail root width bound',()=>assert.match(detail,/\`min\(\$\{visibleDetailWidth\}px, 68%\)\`/)],
 ['master-detail resizer accessible range',()=>assert.match(detail,/role="separator" aria-orientation="vertical" aria-valuemin=\{effectiveMin\}/)],
 ['docked splitter accessible range',()=>assert.match(split,/role="separator" aria-orientation="vertical" aria-valuemin=\{effectiveMin\}/)],
 ['docked splitter viewport width limit',()=>assert.match(css,/min\(var\(--cluster-split-width\), calc\(100% - 290px\)\)/)],
 ['master-detail narrow drag uses runtime token',()=>assert.match(css,/detail-narrow\.detail-open\.detail-resizable \{[^}]*--cluster-detail-width/s)],
 ['only body portal supplies the modal scrim',()=>assert.match(css,/\[data-cluster-inspector-portaled=\"true\"\]::before \{ content: none; \}/)],
 ['portal fullscreen container exists',()=>assert.match(css,/\.cluster-inspector-portal-v546\.cluster-master-detail-v429 \{/)],
 ['mobile pane opaque for accessibility',()=>assert.match(css,/\.cluster-inspector-portal-v546\.cluster-master-detail-v429\.detail-open \.cluster-detail-pane-v429 \{\s*background-color: var\(--cluster-visual-bg-color\)/)],
 ['only topmost floating gets pointer-outside dismissal',()=>assert.match(floating,/if \(panels\[panels\.length - 1\] !== localRef\.current\) return;/)],
 ['outside dismiss respects active modal ownership',()=>assert.match(floating,/if \(topModal && modalOwnerId !== topModal\.id\) return;/)],
 ['inspector material uses Appearance sheen',()=>assert.match(material,/\.cluster-master-detail-v429 \.cluster-detail-pane-v429,[\s\S]*background-image: var\(--cluster-material-sheen\)/)],
 ['inspector high contrast suppresses texture',()=>assert.match(material,/data-high-contrast="true"[^\n]*\.cluster-detail-pane-v429/)],
 ['no new image texture imports',()=>assert.doesNotMatch(material,/url\(/)],
];
for (const [name,run] of tests){run();console.log('PASS',name)}
console.log(`${tests.length}/${tests.length} TD3 P4 surface contract assertions passed`);
