/** TD3 R30: executable native broker acknowledgement contracts plus end-to-end UI source ownership. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireNativeActionConfirmed, requireNativeOpenConfirmed } from '../../packages/renderer/src/features/desktop/desktop-native-outcomes.ts';
const root = resolve(import.meta.dirname, '../..');
const source = readFileSync(resolve(root, 'packages/renderer/src/features/desktop/DesktopNativeServicesPanel.tsx'), 'utf8');
const native = readFileSync(resolve(root, 'apps/desktop-qt/src/NativeCapabilityBroker.cpp'), 'utf8');
const git = readFileSync(resolve(root, 'packages/renderer/src/features/desktop/DesktopWorkstationPanel.tsx'), 'utf8');
const tests = [];
const test = (name, callback) => tests.push([name, callback]);
test('confirmed boolean succeeds', () => assert.equal(requireNativeActionConfirmed(true,'denied'),undefined));
test('false operation is not successful', () => assert.throws(()=>requireNativeActionConfirmed(false,'denied'),/denied/));
test('native open requires explicit opened true',()=>{
 assert.equal(requireNativeOpenConfirmed({opened:true},'denied'),undefined);
 for (const result of [false,undefined,null,{},[],{opened:false},{opened:'true'},{requested:true}]) assert.throws(()=>requireNativeOpenConfirmed(result,'denied'),/denied/);
});
test('native broker returns confirmed open and clipboard contracts',()=>{
 assert.match(native, /"written"\), true/);
 assert.match(native, /"opened"\), true/);
});
test('all three clipboard/file/folder APIs have false-result handling',()=>{
 assert.match(source,/requireNativeActionConfirmed\(completed, `Could not \$\{action\} \$\{item\.name\}\.`/);
 assert.match(source,/requireNativeActionConfirmed\(written, "Desktop clipboard did not accept/);
 assert.match(source,/requireNativeOpenConfirmed\(result, "Desktop widget library folder did not open/);
 assert.match(source,/requireNativeOpenConfirmed\(result, `Could not open Desktop/);
});
test('duplicated native clicks are synchronously locked before awaiting host',()=>{
 assert.match(source,/if \(activeUtilities\.current\.has\(key\)\) return;/);
 assert.match(source,/activeUtilities\.current\.add\(key\);/);
 assert.match(source,/finally \{\s*activeUtilities\.current\.delete\(key\);/);
 for(const key of ['copy-runtime','widget-library-open','servers','settings','capture:screen','capture:region','choose-files','retry-transfers','diagnostics-export']) assert.ok(source.includes(`pendingUtilities.includes("${key}")`),key);
});
test('every native transfer operation uses per-transfer single-flight UI feedback',()=>{
 for(const action of ['pause','resume','retry','open','reveal','cancel','remove']) {
  assert.ok(source.includes(`pendingUtilities.includes(\`transfer:${action}:\${transfer.id}\`)`),action);
  assert.ok(source.includes(`runUtility(\`transfer:${action}:\${transfer.id}\`, () => runTransferAction("${action}", transfer.id))`),action);
 }
});
test('capture preview failure preserves successful captured handle and explains the partial result',()=>{
 assert.match(source,/setItems\(\(current\) => \[captured/);
 assert.match(source,/try \{\s*setPreview\(await previewNativeHandle\(captured\.handle\)\);/);
 assert.match(source,/Capture succeeded and the temporary file remains available/);
});
test('native transfer status refresh failures never misreport mutation as failed',()=>{
 assert.match(source,/Native transfer \$\{action\} request completed/);
 assert.match(source,/latest status could not be refreshed/);
 assert.match(source,/Retry request completed; latest transfer status could not be refreshed/);
});
test('Git mutation, clone, and background task claims are synchronous',()=>{
 assert.match(git,/const inFlightMutations = useRef\(new Set<string>\(\)\);/);
 assert.match(git,/if \(inFlightMutations\.current\.has\(key\)\) return false;/);
 for (const action of ['mutateNativeLocalGit','cloneNativeLocalRepository','runNativeLocalTask','startNativeLocalGitOperation','initializeNativeLocalGit']) {
  const start = git.indexOf(`await ${action}(`);
  assert.ok(start>0, action);
  assert.ok(git.lastIndexOf('claimNativeIntent(',start)>git.lastIndexOf('async function ',start),action);
 }
 assert.ok((git.match(/releaseNativeIntent\(/g)||[]).length>=6);
});
test('Git follow-up LFS refresh failures do not invite duplicate mutations',()=>{
 assert.match(git,/const result = await mutateNativeLocalGit/);
 assert.match(git,/Git \$\{action\.replace\("\.", " "\)\} completed locally, but LFS status could not be refreshed/);
 assert.match(git,/do not repeat the mutation/);
});
let passed=0;
for(const [name,check] of tests){try{await check();console.log('PASS',name);passed++}catch(error){console.error('FAIL',name,error);process.exitCode=1}}
console.log(`${passed}/${tests.length} TD3 R30 native outcome tests passed`);
