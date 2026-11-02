import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = (path) => readFileSync(new URL('../../'+path, import.meta.url), 'utf8');
const qt = source('apps/desktop-qt/src/TransferManager.cpp');
const h = source('apps/desktop-qt/src/TransferManager.h');
const broker = source('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const ts = source('packages/renderer/src/core/desktop.ts');
const ui = source('packages/renderer/src/features/shell/TaskbarTransferCenter.tsx');
const mount = source('apps/desktop-qt/src/LibraryMountManager.cpp');
const contract = [
  [h, /QLockFile \*m_scopeLock = nullptr/, 'lock lifetime explicitly owned by manager'],
  [qt, /m_scopeLock->setStaleLockTime\(0\)/, 'old-but-live lock never evicted merely for age'],
  [qt, /m_scopeWritable = m_scopeLock->tryLock\(0\)/, 'nonblocking atomic writer attempt'],
  [qt, /path \+ QStringLiteral\("\.owner\.lock"\)/, 'lock scoped to exact persisted queue'],
  [qt, /bool TransferManager::ownsQueue\(\) const/, 'central owner predicate'],
  [qt, /releaseScopeOwnership\(\);\n    m_scope = normalized;\n    acquireScopeOwnership\(\);/, 'scope switch releases old before acquiring new'],
  [qt, /releaseScopeOwnership\(\);\n    m_profileDataRoot = normalized;\n    acquireScopeOwnership\(\);/, 'profile switch releases old before acquiring new'],
  [qt, /bool TransferManager::save\(\) const\n\{\n    if \(!ownsQueue\(\)\) return false;/, 'standby cannot publish JSON'],
  [qt, /bool TransferManager::publish\([\s\S]*?if \(!ownsQueue\(\)\) return false;/, 'standby cannot publish in-memory results'],
  [qt, /void TransferManager::processNext\([\s\S]*?if \(!ownsQueue\(\)/, 'standby cannot start a transfer'],
  [qt, /QString TransferManager::startUpload\([\s\S]*?if \(!ownsQueue\(\)\) return \{\};/, 'standby rejects new upload'],
  [qt, /void TransferManager::refreshStandbyQueue\([\s\S]*?m_scopeWritable = m_scopeLock->tryLock\(0\);[\s\S]*?load\(\);/, 'standby rechecks lock before loading'],
  [qt, /QFileSystemWatcher::directoryChanged[\s\S]*?QTimer::singleShot\(250, this/, 'read-only snapshots refresh with bounded filesystem signals'],
  [qt, /ownsQueue\(\) && \(state == QStringLiteral\("running"\)/, 'takeover requires manual resume rather than replaying stranded running work'],
  [qt, /void TransferManager::load\(\)[\s\S]*?const QString path = storagePath\(\);/, 'only canonical profile-scoped journal path is loaded'],
  [qt, /if \(!m_queueReadable\) \{\s*m_transfers.clear\(\);/, 'corrupt canonical journal must remain blocked from writes'],
  [broker, /item.insert\(QStringLiteral\("ownedByAnotherWindow"\), !writable && otherWriter\)/, 'read-only state exposed per entry'],
  [broker, /item.insert\(QStringLiteral\("canPause"\), writable/, 'read-only state disables edit controls'],
  [broker, /TRANSFER_OWNED_BY_ANOTHER_WINDOW/, 'mutating commands fail explicitly, not falsely succeed'],
  [broker, /capability == QStringLiteral\("transfer.claim"\)/, 'manual lease retry is distinct from normal transfer action'],
  [broker, /publishTransferEvent\(\);\n        return QJsonObject\{\{QStringLiteral\("writable"\), writable\}/, 'manual claim reports truthful result'],
  [ts, /claimNativeTransferQueue\(\)/, 'typed renderer capability for manual claim'],
  [ui, /Take over/, 'takeover button visible on standby queue'],
  [ui, /ownedByAnotherWindow/, 'read-only queue explained in Transfer Center'],
  [mount, /TRANSFER_QUEUE_UNAVAILABLE/, 'library mount does not silently drop blocked upload'],
];
let passed=0;
for(const [text,pattern,name] of contract){assert.match(text,pattern,name);passed++;}
console.log(`${passed}/${passed} multi-window queue source contract assertions passed`);
