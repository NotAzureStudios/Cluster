import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = (path) => readFileSync(new URL('../../'+path, import.meta.url), 'utf8');
const manager = read('apps/desktop-qt/src/TransferManager.cpp');
const header = read('apps/desktop-qt/src/TransferManager.h');
const broker = read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const desktop = read('packages/renderer/src/core/desktop.ts');
const ui = read('packages/renderer/src/features/shell/TaskbarTransferCenter.tsx');
const tests = [
 ['explicit journal-invalid reason from queue manager', /if \(!m_queueReadable\) return QStringLiteral\("journal-invalid"\)/.test(manager)],
 ['separate other-window lease reason', /QStringLiteral\("owned-by-another-window"\)/.test(manager)],
 ['manager exposes only redacted queue status', /QString queueBlockedReason\(\) const;/.test(header)],
 ['queue status recognized by native capability allowlist', (broker.match(/QStringLiteral\("transfer.status"\)/g)||[]).length >= 3],
 ['queue status is read-only empty payload', /\{QStringLiteral\("transfer.status"\), \{\}\}/.test(broker)],
 ['status independent of zero transfer entries', /if \(capability == QStringLiteral\("transfer.status"\)\)[\s\S]*?return QJsonObject\{\{QStringLiteral\("writable"\), manager->ownsQueue\(\)\}/.test(broker)],
 ['manual claim does not overwrite damaged journal', /manager->retryOwnership\(\)/.test(broker) || /transferManager\(\)->retryOwnership\(\)/.test(broker)],
 ['status extends claim result', /QStringLiteral\("blockedReason"\), m_controller->transferManager\(\)->queueBlockedReason\(\)/.test(broker)],
 ['mutation refused with precise journal error', /TRANSFER_QUEUE_JOURNAL_INVALID/.test(broker)],
 ['normal locked queue still uses separate owner error', /TRANSFER_OWNED_BY_ANOTHER_WINDOW/.test(broker)],
 ['per-entry ownership claim only when another window owns', /ownedByAnotherWindow"\), !writable && otherWriter/.test(broker)],
 ['typed desktop status capability exists', /getNativeTransferQueueStatus\(\)/.test(desktop) && /"transfer.status"/.test(desktop)],
 ['status loaded independently of list request', /void getNativeTransferQueueStatus\(\)\.then/.test(ui)],
 ['invalid journal warning visible even without rows', /nativeJournalInvalid \? <p className="cluster-transfer-action-error"/.test(ui)],
 ['no takeover button for damaged journal', /const nativeStandby = nativeQueueStatus\?\.blockedReason === "owned-by-another-window"/.test(ui)],
 ['takeover failure can report damaged journal precisely', /result\?\.blockedReason === "journal-invalid"/.test(ui)],
 ['repair warning forbids deletion of retained files', /Do not delete the retained transfer files/.test(ui)],
 ['status does not send local disk path or raw journal content', !/"filePath"|"temporaryPath"/.test(broker.match(/if \(capability == QStringLiteral\("transfer.status"\)\)[\s\S]*?\n    }/)?.[0] || '')],
];
for (const [label, value] of tests) assert.ok(value, label);
console.log(`${tests.length}/${tests.length} native transfer journal status contracts passed`);
