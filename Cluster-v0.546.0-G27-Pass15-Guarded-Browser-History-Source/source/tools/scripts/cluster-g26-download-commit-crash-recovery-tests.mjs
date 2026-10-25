import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = path => readFileSync(new URL('../../'+path,import.meta.url), 'utf8');
const qt = source('apps/desktop-qt/src/TransferManager.cpp');
const types = source('packages/renderer/src/core/desktop.ts');
const summary = source('packages/renderer/src/features/shell/transfer-progress-summary.ts');
function section(name) {
 const at=qt.indexOf(`void TransferManager::${name}(`);
 assert.ok(at >= 0,`exists: ${name}`);
 const end=qt.indexOf('\nvoid TransferManager::',at+10);
 return qt.slice(at,end >= 0 ? end : undefined);
}
const load=section('load'), run=section('runDownload'), verify=section('verifyDownload'), finish=section('finishDownload');
const checks=[
 ['new commit intent is a distinct durable state',/entry.insert\(QStringLiteral\("state"\), QStringLiteral\("committing"\)\)/.test(finish)],
 ['commit includes previously verified SHA256',/entry.insert\(QStringLiteral\("checksumSha256"\), QString::fromLatin1\(checksum\)\)/.test(finish)],
 ['commit receipt is explicitly marked',/entry.insert\(QStringLiteral\("downloadCommitReceipt"\), true\)/.test(finish)],
 ['SHA receipt persisted before rename',finish.indexOf('if (!publish(id, entry)) return;') < finish.indexOf('QFile::rename(temporaryPath, targetPath)')],
 ['completion publication follows rename',finish.lastIndexOf('if (!publish(id, entry)) return;') > finish.indexOf('QFile::rename(temporaryPath, targetPath)')],
 ['success signal follows committed completed state',finish.indexOf('emit transferCompleted') > finish.lastIndexOf('if (!publish(id, entry)) return;')],
 ['crash mid-commit will be paused upon reload',/state == QStringLiteral\("committing"\)/.test(load) && /entry.insert\(QStringLiteral\("state"\), QStringLiteral\("paused"\)\)/.test(load)],
 ['in-flight committing counted as active before crash',/state == QStringLiteral\("committing"\)/.test(qt.slice(qt.indexOf('int TransferManager::activeCount'),qt.indexOf('int TransferManager::pendingCount')))],
 ['manual resume checks commit receipt first',/if \(entry.value\(QStringLiteral\("downloadCommitReceipt"\)\).toBool\(\)\) \{\s*verifyDownload\(id\);\s*return;/.test(run)],
 ['commit recovery does not issue another HTTP GET',run.indexOf('downloadCommitReceipt') < run.indexOf('networkAccessManager()->get(request)')],
 ['only one physical partial or final file admitted',/hasTemporary == hasFinal/.test(verify)],
 ['commit SHA receipt must be 64 hex characters',/\^\[a-fA-F0-9\]\{64\}\$/.test(verify)],
 ['symlink and directory paths refused',/!temporary.isFile\(\) \|\| temporary.isSymLink\(\)/.test(verify) && /!finalFile.isFile\(\) \|\| finalFile.isSymLink\(\)/.test(verify)],
 ['file length must match receipt before hashing',/QFileInfo\(verifyPath\).size\(\) != entry.value\(QStringLiteral\("totalBytes"\)\).toLongLong\(\)/.test(verify)],
 ['hash selects previously committed destination if present',/verifyPath = hasFinal \? targetPath : temporaryPath/.test(verify)],
 ['hash uses selected source path',/QtConcurrent::run\(&TransferManager::sha256File, verifyPath\)/.test(verify)],
 ['SHA over retained bytes must match original commit proof',/TRANSFER_FINALIZE_RECOVERY_CHECKSUM_MISMATCH/.test(finish)],
 ['no destination overwrite if duplicate files present',/!recoveringCommit \|\| temporary.exists\(\) \|\| temporary.isSymLink\(\)/.test(finish)],
 ['normal target collision fails with retained bytes preserved',/TRANSFER_TARGET_ALREADY_EXISTS/.test(finish)],
 ['missing committed partial does not auto-fetch again',/TRANSFER_FINALIZE_SOURCE_INVALID/.test(finish)],
 ['failed rename is manual-retryable',/TRANSFER_FINALIZE_FAILED[\s\S]*?true\);/.test(finish)],
 ['recovery ambiguity is nonretryable',/TRANSFER_FINALIZE_RECOVERY_AMBIGUOUS[\s\S]*?false\);/.test(verify)],
 ['transient committing state is typed',/\| "committing"/.test(types)],
 ['transient committing state is counted as active',/"committing"/.test(summary)],
 ['checksum worker rejects symlinks',/if \(!before.isFile\(\) \|\| before.isSymLink\(\)\) return \{\};/.test(qt)],
 ['checksum worker checks file size and last modified',/after.lastModified\(\) != initialModified/.test(qt) && /after.size\(\) != initialSize/.test(qt)],
 ['no deletion of destination in recovery',!/QFile::remove\(targetPath\)/.test(finish)],
 ['recovery keeps Qt write hold protections',/if \(!ownsQueue\(\)\) return;/.test(run) && /if \(!ownsQueue\(\)\) return;/.test(verify)],
];
for(const [label, yes] of checks) assert.ok(yes,label);
console.log(`${checks.length}/${checks.length} two-phase download finalize/recovery source contracts passed`);
