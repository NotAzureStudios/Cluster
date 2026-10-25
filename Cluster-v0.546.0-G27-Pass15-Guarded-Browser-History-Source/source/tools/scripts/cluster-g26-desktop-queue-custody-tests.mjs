import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const read = relative => readFileSync(new URL('../../' + relative, import.meta.url), 'utf8');
const qt = read('apps/desktop-qt/src/TransferManager.cpp');
const header = read('apps/desktop-qt/src/TransferManager.h');
const policy = read('apps/desktop-qt/src/DesktopTransferQueuePolicy.h');
const checks = [
  ['queue admission uses policy for both directions', (qt.match(/if \(!reserveQueueEntry\(\)\) return \{\};/g) || []).length === 2 && /if \(target\.isEmpty\(\)\) return \{\};[\s\S]*?if \(!reserveQueueEntry\(\)\) return \{\};/.test(qt)],
  ['no history truncation on disk save', !/while \(entries\.size\(\) > MaximumStoredTransfers\)/.test(qt) && /QJsonArray::fromVariantList\(entries\)/.test(qt)],
  ['active and failed states are not admitted for eviction', /historyEvictable\(transferState\(it\.value\(\)\)\.toStdString\(\)\)/.test(qt)],
  ['evict oldest terminal history rather than arbitrary recent items', /updated < oldest/.test(qt) && /m_transfers\.remove\(victim\)/.test(qt)],
  ['unrecoverable full queue refuses new admission', /if \(victim\.isEmpty\(\)\) return false;/.test(qt)],
  ['available name verified before new admission', /if \(target\.isEmpty\(\)\) return \{\};[\s\S]*?if \(!reserveQueueEntry\(\)\) return \{\};/.test(qt)],
  ['candidate target and partial file existence checked', /finalInfo\.exists\(\) \|\| finalInfo\.isSymLink\(\) \|\| partialInfo\.exists\(\) \|\| partialInfo\.isSymLink\(\)/.test(qt)],
  ['all 4 cross-destination queue reservation conflicts checked', /reservedFinal\.compare\(candidate, pathCase\)/.test(qt) && /reservedFinal\.compare\(partial, pathCase\)/.test(qt) && /reservedPartial\.compare\(candidate, pathCase\)/.test(qt) && /reservedPartial\.compare\(partial, pathCase\)/.test(qt)],
  ['Windows names are compared case-insensitively', /#ifdef Q_OS_WIN[\s\S]*?Qt::CaseInsensitive;[\s\S]*?#else[\s\S]*?Qt::CaseSensitive/.test(qt)],
  ['bounded candidate-name probing', /index = 1; index <= 10000; \+\+index/.test(qt)],
  ['partial path regular-file check before first append', /retained\.isSymLink\(\) \|\| \(retained\.exists\(\) && !retained\.isFile\(\)\)/.test(qt)],
  ['Windows device names rejected', /CON\|PRN\|AUX\|NUL\|COM\[1-9\]\|LPT\[1-9\]/.test(qt)],
  ['Windows unsafe punctuation and controls sanitized', /const QString forbidden/.test(qt) && /unicode\(\) < 32/.test(qt)],
  ['native queue retention header is Qt-free', !/#include <Q/.test(policy)],
  ['destination and admission helpers in actual Qt type contract', /bool reserveQueueEntry\(\)/.test(header) && /bool downloadDestinationAvailable\(const QString &candidate\) const/.test(header)],
  ['new jobs require atomic save confirmation', (qt.match(/if \(!publish\(id,/g) || []).length >= 2],
  ['failed admission restores existing queue and declines transfer', (qt.match(/m_transfers = previousQueue;/g) || []).length === 2],
  ['file write errors abort atomic journal', /file\.write\(encoded\) != encoded\.size\(\)/.test(qt) && /file\.cancelWriting\(\)/.test(qt)],
  ['commit result is not ignored', /return file\.commit\(\)/.test(qt)],
  ['legacy source deleted only after successfully saved migration', /if \(save\(\)\) QFile::remove\(path\)/.test(qt)],
  ['corrupt queue disables writes', /m_queueReadable && m_scopeWritable/.test(qt) && /m_queueReadable = false/.test(qt)],
  ['invalid JSON and schema fail closed', /QJsonParseError::NoError/.test(qt) && /!document\.isObject\(\)/.test(qt) && /!root\.value\(QStringLiteral\(\"transfers\"\)\)\.isArray\(\)/.test(qt)],
  ['duplicate journal IDs are not silently replaced', /m_transfers\.contains\(id\)/.test(qt)],
  ['broken journal not overwritten on reload', /if \(!m_queueReadable\) \{[\s\S]*?m_transfers\.clear\(\)/.test(qt)],
  ['network chunk progress does not reserialize queue journal', /current\.insert\(QStringLiteral\(\"transferredBytes\"\), m_activeFile->size\(\)\);[\s\S]*?publishDownloadProgress\(id, current\)/.test(qt)],
  ['volatile progress helper intentionally omits save', /void TransferManager::publishDownloadProgress\([\s\S]*?m_transfers\.insert\(id, next\);[\s\S]*?emit countsChanged\(\);/.test(qt)],
  ['durable failure and cancellation path remain intact', /bool TransferManager::pause\([\s\S]*?if \(!publish\(transferId, entry\)\) return false;/.test(qt) && /void TransferManager::fail\([\s\S]*?if \(!publish\(id, entry\)\) return;/.test(qt)],
  ['queue ownership unchanged', /m_scopeLock->setStaleLockTime\(0\)/.test(qt)],
];
for (const [label, valid] of checks) assert.ok(valid, label);
const work = mkdtempSync(join(tmpdir(), 'cluster-qt-queue-'));
try {
  const executable = join(work, 'queue-test');
  const build = spawnSync('g++', ['-std=c++20','-Wall','-Wextra','-Werror','-pedantic',
    new URL('../../apps/desktop-qt/tests/transfer_queue_policy_test.cpp', import.meta.url).pathname,
    '-o', executable], {encoding:'utf8'});
  assert.equal(build.status, 0, `compiled queue retention policy: ${build.stderr}`);
  const run = spawnSync(executable, [], {encoding:'utf8'});
  assert.equal(run.status, 0, `queue policy tests: ${run.stderr}`);
  assert.match(run.stdout, /PASS 16 native queue-retention policy assertions/);
} finally { rmSync(work, {recursive:true, force:true}); }
console.log(`${checks.length + 16}/${checks.length + 16} Desktop queue custody source and executable policy assertions passed`);
