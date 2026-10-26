import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL('../../'+path, import.meta.url),'utf8');
const manager=read('apps/desktop-qt/src/TransferManager.cpp');
const broker=read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const journal=read('apps/desktop-qt/src/DesktopTransferJournalPolicy.h');
const header=read('apps/desktop-qt/src/TransferManager.h');
const section=(from,to)=> {
 const a=manager.indexOf(from);assert.ok(a>=0,'missing '+from);
 const b=manager.indexOf(to,a+from.length);assert.ok(b>a,'missing '+to);
 return manager.slice(a,b);
};
const newDownload=section('QString TransferManager::startDownload(', 'bool TransferManager::pause(');
const newUpload=section('QString TransferManager::startUpload(', 'QString TransferManager::startDownload(');
const loaded=section('bool TransferManager::validJournalEntry(', 'bool TransferManager::uploadSourceMatches(');
const source=section('bool TransferManager::uploadSourceMatches(', 'bool TransferManager::downloadPathsSafe(');
const downloadPath=section('bool TransferManager::downloadPathsSafe(', 'bool TransferManager::removeOwnedPartial(');
const runDownload=section('void TransferManager::runDownload(', 'void TransferManager::verifyDownload(');
const verifyDownload=section('void TransferManager::verifyDownload(', 'void TransferManager::finishDownload(');
const finishDownload=section('void TransferManager::finishDownload(', 'void TransferManager::fail(');
const openResult=section('bool TransferManager::openResult(', 'bool TransferManager::remove(');
const cleanup=section('bool TransferManager::removeOwnedPartial(', 'bool TransferManager::reserveQueueEntry(');
const upload=section('void TransferManager::runUpload(', 'void TransferManager::createUploadSession(');
const chunk=section('void TransferManager::sendUploadChunk(', 'void TransferManager::verifyUpload(');
const verify=section('void TransferManager::verifyUpload(', 'void TransferManager::completeUpload(');
const complete=section('void TransferManager::completeUpload(', 'void TransferManager::finalizeUpload(');
const query=section('void TransferManager::queryUploadSession(', 'void TransferManager::resumeServerUploadSession(');
const checks=[
 ['queued download explicitly records a zero total', /\{QStringLiteral\("totalBytes"\), 0\}/.test(newDownload)],
 ['queued download explicitly records zero bytes transferred', /\{QStringLiteral\("transferredBytes"\), 0\}/.test(newDownload)],
 ['download total is independently required by journal load', /!totalValue.isDouble\(\) \|\| !progressValue.isDouble\(\)/.test(loaded)],
 ['download checksum requires a valid digest at direct queue entry', /journal::validSha256\(expectedChecksumSha256.toStdString\(\)\)/.test(newDownload)],
 ['renderer-origin download constraints remain active', /sameServerApiPath\(url.toStdString\(\)\)/.test(broker)],
 ['uploaded source generation is durably recorded', /sourceModifiedAtMs/.test(newUpload) && /lastModified\(\).toMSecsSinceEpoch\(\)/.test(newUpload)],
 ['upload admission rejects initial symlinks', /info.isSymLink\(\)/.test(newUpload)],
 ['upload admission caps JSON numeric size', /maximumExactJsonInteger/.test(newUpload)],
 ['invalid source generations are rejected on recovered entries', /!sourceModified.isDouble\(\)/.test(loaded) && /validSourceModifiedAt\(sourceModified.toInteger\(-1\)\)/.test(loaded)],
 ['unversioned historical jobs remain readable but never auto-resume', /sourceModified.isUndefined\(\)/.test(loaded) && /TRANSFER_UPLOAD_SOURCE_UNPINNED/.test(upload)],
 ['Qt-free journal metadata policy validates generation', /inline bool validSourceModifiedAt/.test(journal)],
 ['source identity guard checks source and path', /info.isAbsolute\(\)/.test(source) && /!info.isSymLink\(\)/.test(source) && /info.isReadable\(\)/.test(source)],
 ['source identity guard checks exact file length and mtime', /info.size\(\) == entry.value/.test(source) && /lastModified\(\).toMSecsSinceEpoch\(\) == generation/.test(source)],
 ['source identity contract declared in TransferManager header', /uploadSourceMatches\(const QVariantMap &entry\) const/.test(header)],
 ['upload session cannot be created if source changed', /uploadSourceMatches\(entry\)/.test(upload)],
 ['upload source must remain valid before every chunk', /uploadSourceMatches\(entry\)/.test(chunk)],
 ['upload chunk rejects short reads or post-read source mutation', /chunk.size\(\) != qMin\(UploadChunkBytes, total - offset\) \|\| !uploadSourceMatches\(entry\)/.test(chunk)],
 ['upload before verify again checks source generation', /uploadSourceMatches\(entry\)/.test(verify)],
 ['upload after async hash again checks source generation', /checksum.isEmpty\(\) \|\| !uploadSourceMatches\(transfer\(id\)\)/.test(verify)],
 ['server complete endpoint checks source just before mutation', /uploadSourceMatches\(entry\)/.test(complete)],
 ['changed sources are held nonretryable until new selection', (manager.match(/TRANSFER_UPLOAD_SOURCE_CHANGED/g)||[]).length >= 4 && /false\);/.test(upload)],
 ['credentialed upload requests refuse redirects', /void addCsrf[\s\S]*?ManualRedirectPolicy/.test(manager)],
 ['upload status inspection also refuses redirects', /RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy/.test(query)],
 ['native broker still limits selected file handles', /resolveHandle\(handle\)/.test(broker)],
 ['download path guard declared', /downloadPathsSafe\(const QVariantMap &entry\) const/.test(header)],
 ['download final and partial paths must be paired', /journal::pairedPartial\(target.toStdString\(\), partial.toStdString\(\)\)/.test(downloadPath)],
 ['download path guard rejects links and non-regular files', /finalInfo.isSymLink\(\) \|\| partInfo.isSymLink\(\)/.test(downloadPath) && /!partInfo.isFile\(\)/.test(downloadPath)],
 ['download path guard constrains destination to current Downloads folder', /currentDownloads = QDir::cleanPath\(downloadDirectory\(\)\)/.test(downloadPath) && /absolutePath\(\)\).compare\(currentDownloads, pathCase\)/.test(downloadPath)],
 ['download upload path fence triggers before network work', /downloadPathsSafe\(entry\)/.test(runDownload) && /TRANSFER_DOWNLOAD_DESTINATION_UNTRUSTED/.test(runDownload)],
 ['download checksum must not inspect untrusted destination', /downloadPathsSafe\(entry\)/.test(verifyDownload)],
 ['download publication must recheck destination', /downloadPathsSafe\(entry\)/.test(finishDownload)],
 ['opening complete artifacts must check destination', (openResult.match(/downloadPathsSafe\(entry\)/g)||[]).length===2],
 ['cancel cleanup shares root/path guard', /downloadPathsSafe\(entry\)/.test(cleanup)],
];
for (const [name, ok] of checks) assert.ok(ok,name);
console.log(`${checks.length}/${checks.length} Pass 19 native journal and upload generation assertions passed`);
