import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file = (relative) => readFileSync(new URL('../../' + relative, import.meta.url),'utf8');
const drawer=file('packages/renderer/src/features/create/SharedCreateDrawer.tsx');
const app=file('packages/renderer/src/features/application/ClusterApplication.tsx');
const handoff=file('packages/renderer/src/features/create/shared-create-handoff.ts');
let count=0; const check=(title,fn)=>{fn();count++;console.log('PASS '+title)};
check('open Create accepts a live handoff event while already mounted',()=>{
  assert.match(drawer,/window\.addEventListener\("cluster:open-shared-create", onCreateHandoff\)/);
  assert.match(drawer,/window\.removeEventListener\("cluster:open-shared-create", onCreateHandoff\)/);
});
check('handoff is drained immediately before any rejection or confirmation',()=>{
  const handler=drawer.slice(drawer.indexOf('const onCreateHandoff = () => {'),drawer.indexOf('window.addEventListener("cluster:open-shared-create"'));
  assert.ok(handler.indexOf('const incoming = readSharedCreateHandoff()')<handler.indexOf('if (busy || createIntentRef.current.inFlight)'));
  assert.ok(handler.indexOf('const incoming = readSharedCreateHandoff()')<handler.indexOf('const discard = await confirmCluster'));
});
check('busy or in-flight mutation is never replaced',()=>assert.match(drawer,/if \(busy \|\| createIntentRef\.current\.inFlight\) \{[\s\S]*?return;\s*\}/));
check('unavailable Create type is rejected before touching old draft',()=>{
  const handler=drawer.slice(drawer.indexOf('const onCreateHandoff = () => {'),drawer.indexOf('window.addEventListener("cluster:open-shared-create"'));
  assert.ok(handler.indexOf('!canOfferCreateMode(incoming.mode)')<handler.indexOf('await clearOfflineDraft(draftKey)'));
});
check('autosaved draft is preserved before switching Create type',()=>assert.match(drawer,/await saveOfflineDraft\(draftKey, draftSnapshot, \{ ttlMs: 30 \* 24 \* 60 \* 60 \* 1000 \}\)/));
check('explicit confirmation required before dropping non-autosaved work',()=>{
  assert.match(drawer,/title: "Switch Create type\?"/);
  assert.match(drawer,/if \(!isCurrent\(\) \|\| !discard\) return;/);
});
check('created records cannot leave old draft behind when switching',()=>{
  assert.match(drawer,/if \(createIntentRef\.current\.committed\) \{\s*try \{ await clearOfflineDraft\(draftKey\); \}/);
});
check('failed preservation or cleanup retains the current form',()=>{
  assert.match(drawer,/Could not preserve the current draft\. Keep editing or retry\./);
  assert.match(drawer,/Could not clear the old draft\. Keep editing or retry\./);
});
check('newer handoff invalidates older asynchronous prompts',()=>{
  assert.match(drawer,/const ticket = \+\+handoffRequestRef\.current/);
  assert.match(drawer,/ticket === handoffRequestRef\.current && !createSessionController\.current\.signal\.aborted/);
});
check('accepted handoff reuses complete existing Create initializer',()=>{
  assert.match(drawer,/acceptedHandoffRef\.current = incoming;\s*initializedCreateRef\.current = false;\s*setHandoffRevision/);
  assert.match(drawer,/const handoff = acceptedHandoffRef\.current \|\| readSharedCreateHandoff\(\)/);
  assert.match(drawer,/createMemory\.hydrated, handoffRevision\]/);
});
check('mounted Create and Search remount on account switches',()=>{
  assert.match(app,/<LazyQuickCreateDrawer\s+key=\{activeUser\.id\}/);
  assert.match(app,/<LazyCommandPalette\s+key=\{activeUser\.id\}/);
});
check('openSharedCreate queue remains session-bound for pre-mount events',()=>{
  assert.match(handoff,/pendingSharedCreateHandoff = bindSessionHandoff\(detail\)/);
  assert.match(handoff,/window\.dispatchEvent\(new CustomEvent<SharedCreateHandoff>\("cluster:open-shared-create"/);
  assert.match(handoff,/return unwrapSessionHandoff\(handoff\)/);
});
console.log(`${count}/${count} G27 P58 live Create handoff checks passed`);
