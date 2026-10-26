import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL('../../' + relative, import.meta.url), 'utf8');
const qt = read('apps/desktop-qt/src/TransferManager.cpp');
const broker = read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const go = read('tools/native/package-stager-go/durable_transfer.go');
const nativeTest = read('tools/native/package-stager-go/transfer_pending_recovery_test.go');
const packageJson = JSON.parse(read('package.json'));
const checks = [
  [qt, /if \(!QDir\(\)\.mkpath\(directory\)\) return;/, 'new profile transfer storage can be initialized'],
  [qt, /if \(!dirInfo\.isDir\(\) \|\| dirInfo\.isSymLink\(\)\) return;/, 'transfer queue refuses direct directory symlinks'],
  [qt, /QDir\(\)\.mkpath\(directory\)[\s\S]*?m_scopeLock->tryLock\(0\)/, 'directory created before lock acquisition'],
  [qt, /m_scopeLock->setStaleLockTime\(0\)/, 'single writer never evicts lock by age'],
  [qt, /QStringLiteral\("\/api\/uploads"\)/, 'Qt upload uses canonical API'],
  [qt, /cluster::desktop::download::admit\(/, 'download response range admission remains intact'],
  [broker, /TRANSFER_OWNED_BY_ANOTHER_WINDOW/, 'second window mutations rejected by broker'],
  [go, /func verifiedTransferCheckpoint\(meta, part, archive string, recoveryProof bool\)/, 'native committed archive proof can be independently verified'],
  [go, /incomplete transfer checkpoint publication; explicit recovery required/, 'normal reads reject pending publication'],
  [nativeTest, /TestCommittedTransferPendingResidueRequiresExplicitRecovery/, 'interrupted committed state has executable regression'],
];
for (const [value, expression, name] of checks) assert.match(value, expression, name);
for (const key of [
  'cluster:g26:qt-download-continuity',
  'cluster:g26:multiwindow-transfer-ownership',
  'cluster:g26:qt-canonical-upload',
]) assert.equal(typeof packageJson.scripts[key], 'string', key);
console.log(`${checks.length + 3}/${checks.length + 3} merged G26 source-contract checks passed`);
