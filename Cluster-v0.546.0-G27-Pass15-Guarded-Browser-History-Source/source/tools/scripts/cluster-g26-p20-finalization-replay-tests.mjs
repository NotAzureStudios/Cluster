import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const code=read('apps/desktop-qt/src/TransferManager.cpp');
const journal=read('apps/desktop-qt/src/DesktopTransferJournalPolicy.h');
const backend=read('apps/server/src/app/server-routes-media-whiteboards.ts');
const meta=read('apps/server/src/domains/projects/project-asset-routes.ts');
function slice(from,to){const a=code.indexOf(from),b=code.indexOf(to,a+from.length);assert(a>=0&&b>a,`missing ${from}..${to}`);return code.slice(a,b)}
const validation=slice('bool TransferManager::validJournalEntry(', 'bool TransferManager::uploadSourceMatches(');
const uploader=slice('void TransferManager::runUpload(', 'void TransferManager::createUploadSession(');
const proof=slice('void TransferManager::completeUpload(', 'void TransferManager::finalizeUpload(');
const finalizer=slice('void TransferManager::finalizeUpload(', 'void TransferManager::runDownload(');
const checks=[
 ['portable journal policy models an uploaded server receipt',/validUploadCompletionReceipt\(/.test(journal)],
 ['receipt requires SHA-256 and full acknowledged byte count',/transferred == total && validSha256\(checksum, false\)/.test(journal)],
 ['journal enforces boolean upload receipt',/!completion.isUndefined\(\) && !completion.isBool\(\)/.test(validation)],
 ['journal requires canonical nonempty destination for receipt',/completion.toBool\(\) && \(!finalize.isString\(\) \|\| finalize.toString\(\).isEmpty\(\)/.test(validation)],
 ['journal requires strict session validation independent of receipt',/request::validUploadId\(session.toString\(\).toStdString\(\)\)/.test(validation)],
 ['journal requires checksum-bound full bytes',/validUploadCompletionReceipt\(true, session.toString\(\).toStdString\(\), total/.test(validation)],
 ['runUpload prioritizes committed receipt before source-restat',uploader.indexOf('uploadCompletionReceipt')<uploader.indexOf('uploadSourceMatches(entry)')],
 ['recovery explicitly invokes idempotent finalizer from receipt',/finalizeUpload\(id, \{[\s\S]*?checksumSha256/.test(uploader)],
 ['normal uploads still verify local source before remote writes',/if \(!uploadSourceMatches\(entry\)\)/.test(uploader)],
 ['server completion response requires original uploadId',/result.value\(QStringLiteral\("uploadId"\)\)/.test(proof)],
 ['server completion response requires SHA and bytes',/TRANSFER_COMPLETE_PROOF_INVALID/.test(proof)],
 ['finalizer checks server receipt against journal identity',/verifiedSession != entry.value\(QStringLiteral\("uploadSessionId"\)\)/.test(finalizer)],
 ['finalizer checks SHA/length before durable receipt',/validUploadCompletionReceipt\([\s\S]*?verifiedHash.toStdString\(\)/.test(finalizer)],
 ['finalizer stores committing state, digest and bytes',/entry.insert\(QStringLiteral\("uploadCompletionReceipt"\), true\)/.test(finalizer) && /entry.insert\(QStringLiteral\("state"\), QStringLiteral\("committing"\)\)/.test(finalizer)],
 ['durable receipt saved before finalizer network POST',finalizer.indexOf('if (!publish(id, entry)) return;')<finalizer.indexOf('networkAccessManager()->post(')],
 ['finalizer uses stable Qt idempotency key',/X-Cluster-Idempotency-Key/.test(finalizer) && /qt-transfer:%1/.test(finalizer)],
 ['finalization validates server response file id',/TRANSFER_FINALIZATION_PROOF_INVALID/.test(finalizer) && /fileId.isEmpty\(\)/.test(finalizer)],
 ['finalization validates project, checksum and file bytes',/finalized.value\(QStringLiteral\("projectId"\)\)/.test(finalizer) && /finalized.value\(QStringLiteral\("checksumSha256"\)\)/.test(finalizer) && /finalized.value\(QStringLiteral\("sizeBytes"\)\)/.test(finalizer)],
 ['finalization commit publishes full result only after validation',finalizer.indexOf('TRANSFER_FINALIZATION_PROOF_INVALID')<finalizer.lastIndexOf('entry.insert(QStringLiteral("state"), QStringLiteral("complete"))')],
 ['server finalizer independently authorizes project contribution',/authorization.requireProjectResource\(request, reply, project, "library", "contribute"\)/.test(backend)],
 ['server verifies same upload id for existing finalized record',/existingByUpload.projectId !== params.projectId/.test(backend)],
 ['server accepts idempotent replay before consumed-session load',backend.indexOf('if (existingByUpload)')<backend.indexOf('const stored = await storeCompletedUpload')],
 ['server persists ingestSessionId for idempotent project asset',/ingestSessionId: body.uploadId/.test(backend)],
 ['server serializer hides private ingestSessionId',/ingestSessionId: _ingestSessionId/.test(meta)],
 ['upload finalizer does not delete its session after success',!finalizer.includes('networkAccessManager()->deleteResource(')],
];
for(const [name,ok] of checks) assert.ok(ok,name);
console.log(`${checks.length}/${checks.length} G26 Pass 20 durable post-upload finalization replay source assertions passed`);
