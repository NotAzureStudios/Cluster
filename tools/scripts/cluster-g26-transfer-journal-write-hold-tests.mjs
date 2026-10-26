import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (name) => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const cpp = read('apps/desktop-qt/src/TransferManager.cpp');
const header = read('apps/desktop-qt/src/TransferManager.h');
const broker = read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const desktop = read('packages/renderer/src/core/desktop.ts');
const ui = read('packages/renderer/src/features/shell/TaskbarTransferCenter.tsx');
function block(name) {
  const start = cpp.search(new RegExp(`(?:void|bool) TransferManager::${name}\\(`));
  assert.ok(start >= 0, `${name} exists`);
  const open = cpp.indexOf('{', start);
  let level = 0;
  for (let i=open;i<cpp.length;i++) {
    if(cpp[i]==='{') level++;
    if(cpp[i]==='}' && --level===0) return cpp.slice(open+1,i);
  }
  throw Error(`unbalanced ${name}`);
}
const checks = [
 ['writer lease withheld after journal write failure', /m_scopeLock->isLocked\(\) && !m_queueWriteFailed/.test(cpp)],
 ['distinct failure flag retained in Qt manager', /bool m_queueWriteFailed = false;/.test(header)],
 ['distinct reason takes precedence over corrupt journal', /if \(m_queueWriteFailed\) return QStringLiteral\("journal-write-failed"\);\s*if \(!m_queueReadable\)/.test(cpp)],
 ['write failure stops active work and aborts pending reply', /void TransferManager::holdFailedJournalWrite\(\)[\s\S]*?m_queueWriteFailed = true;[\s\S]*?m_activeId.clear\(\);[\s\S]*?m_activeReply->abort\(\);/.test(cpp)],
 ['write failure closes active output without deleting its bytes', /void TransferManager::holdFailedJournalWrite\(\)[\s\S]*?m_activeFile->flush\(\);[\s\S]*?m_activeFile->close\(\);/.test(cpp)],
 ['failed publish restores prior in-memory record', /if \(existed\) m_transfers.insert\(id, previous\);[\s\S]*?else m_transfers.remove\(id\);[\s\S]*?holdFailedJournalWrite\(\);/.test(cpp.slice(cpp.indexOf('bool TransferManager::publish('),cpp.indexOf('void TransferManager::publishDownloadProgress(')))],
 ['failed remove restores removed entry and holds', /if \(!save\(\)\) \{\s*m_transfers.insert\(transferId, previous\);\s*holdFailedJournalWrite\(\);\s*return false;/.test(block('remove'))],
 ['failed legacy journal migration retains source and holds', /if \(save\(\)\) QFile::remove\(path\);\s*else holdFailedJournalWrite\(\);/.test(cpp)],
 ['background directory watcher cannot silently clear failed-write hold', /void TransferManager::refreshStandbyQueue\(\)[\s\S]*?if \(m_queueWriteFailed \|\| !m_scopeLock \|\| ownsQueue\(\)\) return;/.test(cpp)],
 ['explicit recovery waits for abandoned network/file handles', /if \(m_activeReply \|\| m_activeFile\) return false;[\s\S]*?m_queueWriteFailed = false;[\s\S]*?load\(\)/.test(cpp)],
 ['reloaded in-flight jobs are paused not replayed', /state == QStringLiteral\("running"\) \|\| state == QStringLiteral\("queued"\)[\s\S]*?state == QStringLiteral\("verifying"\) \|\| state == QStringLiteral\("committing"\)/.test(cpp) && /entry.insert\(QStringLiteral\("state"\), QStringLiteral\("paused"\)\)/.test(cpp)],
 ['file download header save blocks before response bytes', /if \(!publish\(id, current\)\) return;/.test(cpp) && /if \(!ownsQueue\(\) \|\| !m_downloadHeadersAccepted/.test(cpp)],
 ['failure responses do not spuriously notify a completed or failed transfer', /if \(!publish\(id, entry\)\) return;[\s\S]*?m_activeId.clear\(\);\s*emit transferFailed/.test(block('fail'))],
 ['Qt capability broker rejects mutation with distinct error', /TRANSFER_QUEUE_JOURNAL_WRITE_FAILED/.test(broker)],
 ['renderer declares new blocked reason', /"journal-write-failed"/.test(desktop)],
 ['Desktop UI provides explicit journal reload action', /nativeJournalWriteFailed \? <ClusterButton[\s\S]*?Retry journal<\/ClusterButton>/.test(ui)],
 ['Desktop shows retained data warning', /previous journal and retained files have not been deleted/.test(ui)],
 ['corrupt journal still has a separate non-takeover warning', /nativeJournalInvalid \? <p/.test(ui) && /owned-by-another-window/.test(ui)],
];
for (const name of ['runUpload', 'createUploadSession', 'queryUploadSession',
  'resumeServerUploadSession','sendUploadChunk', 'verifyUpload', 'completeUpload',
  'finalizeUpload','runDownload','verifyDownload','finishDownload']) {
  checks.push([`${name} refuses to continue after failed save`, /^\s*if \(!ownsQueue\(\)\) return;/.test(block(name))]);
}
checks.push(['paused state only applied after committed journal write', /if \(!publish\(transferId, entry\)\) return false;[\s\S]*?m_activeReply->abort\(\)/.test(block('pause'))]);
checks.push(['cancel cannot remove retained part after failed save', /if \(!publish\(transferId, entry\)\) return false;[\s\S]*?removeOwnedPartial\(entry\)/.test(block('cancel'))]);
checks.push(['completed download does not emit success after failed save', /if \(!publish\(id, entry\)\) return;[\s\S]*?emit transferCompleted/.test(block('finishDownload'))]);
for (const [label, truth] of checks) assert.ok(truth, label);
console.log(`${checks.length}/${checks.length} post-admission transfer journal write-hold contracts passed`);
