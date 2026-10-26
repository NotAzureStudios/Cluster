import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const ts = require(path.resolve(process.execPath, '../../lib/node_modules/typescript/lib/typescript.js'));
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(read('packages/renderer/src/features/help/contextual-help.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports });
const { CLUSTER_HELP_NAVIGABLE_SCREENS, CLUSTER_HELP_TOPICS, canNavigateFromHelp } = mod.exports;
let n=0;function check(name,fn){fn();console.log('PASS '+name);n++}
for(const screen of ['project','board','whiteboard','desktop']) check(`Exact-resource or host-specific ${screen} cannot navigate without context`,()=>assert.equal(canNavigateFromHelp(screen,()=>true),false));
for(const screen of CLUSTER_HELP_NAVIGABLE_SCREENS) check(`${screen} Help navigation honors current permission predicate`,()=>{
 assert.equal(canNavigateFromHelp(screen,()=>true),true);
 assert.equal(canNavigateFromHelp(screen,()=>false),false);
});
check('All navigable Help screens have documentation',()=>{const covered = new Set(CLUSTER_HELP_TOPICS.map(x=>x.screen)); for(const screen of CLUSTER_HELP_NAVIGABLE_SCREENS)assert.ok(covered.has(screen),screen)});
check('Help exposes guarded in-article navigation',()=>{const src=read('packages/renderer/src/features/help/ClusterHelpDialog.tsx');assert.match(src,/canNavigateFromHelp\(active\.screen, canAccess\)/);assert.match(src,/onNavigate\(active\.screen\)/);});
check('Application rechecks authorization and passes through kiosk-safe shell navigation',()=>{const src=read('packages/renderer/src/features/application/ClusterApplication.tsx'); assert.match(src,/onNavigate=\{\(destination\) => \{ if \(canOpenScreen\(activeUser, destination\)\)/);assert.match(src,/void setScreen\(destination\)/);});
console.log(`G27 P35 Help navigation: ${n}/${n} passed`);
