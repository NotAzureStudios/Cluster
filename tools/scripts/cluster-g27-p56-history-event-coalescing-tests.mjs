import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../../packages/renderer/src/features/application/ClusterApplication.tsx',import.meta.url),'utf8');
let n=0;const check=(title,fn)=>{fn();n++;console.log('PASS '+title)};
const historyEffect=app.slice(app.indexOf('let navigationSequence = 0;'),app.indexOf('  const currentNavigation = createNavigationState(screen'));
check('both history events share one scheduling path',()=>{
 assert.match(historyEffect,/const restorePopState = \(event: PopStateEvent\) => \{\s*scheduleRestore\(/);
 assert.match(historyEffect,/const restoreHash = \(\) => \{ scheduleRestore\(/);
});
check('pending duplicate event is cancelled before reads',()=>{
 assert.match(historyEffect,/if \(scheduledRestore !== null\) window\.clearTimeout\(scheduledRestore\);\s*const interactiveEpoch/);
 assert.ok(historyEffect.indexOf('window.setTimeout(() => {\n        scheduledRestore = null;') < historyEffect.indexOf('void restore(candidate).catch'));
});
check('manual route change suppresses queued history events',()=>{
 assert.match(historyEffect,/if \(interactiveEpoch !== interactiveNavigationEpochRef\.current\) return;/);
});
check('listeners clean up both pending timers and event subscriptions',()=>{
 assert.match(historyEffect,/return \(\) => \{\s*navigationSequence \+= 1;\s*if \(scheduledRestore !== null\) window\.clearTimeout\(scheduledRestore\)/);
 assert.match(historyEffect,/window\.removeEventListener\("popstate", restorePopState\)/);
 assert.match(historyEffect,/window\.removeEventListener\("hashchange", restoreHash\)/);
});
check('history server admission runs only after coalescing',()=>{
 assert.ok(historyEffect.indexOf('const restore = async') < historyEffect.indexOf('const scheduleRestore'));
 assert.match(historyEffect,/void restore\(candidate\)\.catch/);
});
check('failed async history confirmation repairs the current URL',()=>{
 assert.match(historyEffect,/void restore\(candidate\)\.catch\(\(\) => \{[\s\S]*?window\.history\.replaceState\(current/);
 assert.match(historyEffect,/ownerEpoch !== historyAuthRef\.current\.epoch/);
});
console.log(`${n}/${n} G27 Pass 56 history event checks passed`);
