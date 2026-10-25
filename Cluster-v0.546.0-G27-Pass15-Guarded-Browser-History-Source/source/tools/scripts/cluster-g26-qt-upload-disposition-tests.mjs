import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = (file) => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
const qt = source('apps/desktop-qt/src/TransferManager.cpp');
const qth = source('apps/desktop-qt/src/TransferManager.h');
const broker = source('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const ui = source('packages/renderer/src/features/shell/TaskbarTransferCenter.tsx');
const desktop = source('packages/renderer/src/core/desktop.ts');
const server = source('apps/server/src/domains/uploads/upload-session-routes.ts');
const checks = [
 [qt, /entry\.isEmpty\(\) \|\| terminalState\(transferState\(entry\)\)/, 'Completed transfers cannot be canceled'],
 [qt, /remoteDisposition"\), hasServerSession\s*\? QStringLiteral\("unconfirmed"\) : QStringLiteral\("unknown"\)/, 'Local cancel begins with truthful remote-unknown status'],
 [qt, /if \(isUpload && hasServerSession && m_api && m_api->online\(\)\)/, 'Only known online uploads may trigger an automatic explicit cancel'],
 [qt, /retryDiscardCancelledUpload\(const QString &transferId\)/, 'Retry remote disposition is user-triggered'],
 [qt, /QStringLiteral\("state"\)\)\.toString\(\) != QStringLiteral\("cancelled"\)/, 'Remote discard requires canceled local state'],
 [qt, /QStringLiteral\("remoteDisposition"\)\)\.toString\(\) == QStringLiteral\("discarded"\)/, 'Remote deletion cannot be reissued after confirmation'],
 [qt, /QStringLiteral\("remoteDisposition"\)\)\.toString\(\) == QStringLiteral\("pending"\)/, 'In-flight request blocks duplicate delete'],
 [qt, /addCsrf\(request, m_api\);[\s\S]*?deleteResource\(request\)/, 'Authenticated server session delete with CSRF'],
 [qt, /reply->error\(\) == QNetworkReply::NoError && status == 204/, 'Remote deletion only confirmed on 204'],
 [qt, /if \(!ownsQueue\(\) \|\| m_scope != scope\) return;/, 'Stale cross-scope reply cannot corrupt current queue'],
 [qt, /current\.value\(QStringLiteral\("uploadSessionId"\)\)\.toString\(\) != sessionId/, 'Stale remote-session response cannot confirm a different session'],
 [qt, /confirmed \? QStringLiteral\("discarded"\) : QStringLiteral\("unconfirmed"\)/, 'Failures retain unconfirmed disposition'],
 [qt, /entry\.insert\(QStringLiteral\("remoteDisposition"\), QStringLiteral\("unconfirmed"\)\)/, 'Pending deletes become unconfirmed after a client crash'],
 [broker, /QStringLiteral\("remoteDisposition"\)/, 'Native broker projects status not bearer session id'],
 [broker, /QStringLiteral\("canDiscardRemote"\)/, 'Native broker gates retry of remote cleanup'],
 [broker, /QStringLiteral\("transfer\.discardRemote"\)/, 'Native capability explicitly registered'],
 [broker, /manager->retryDiscardCancelledUpload\(transferId\)/, 'Capability calls guarded method'],
 [desktop, /export async function retryDiscardNativeUpload\(transferId: string\)/, 'Renderer has typed action'],
 [ui, /canceledUnconfirmed\.map/, 'Taskbar surfaces retained canceled-upload warnings'],
 [ui, /Server discard not confirmed/, 'UI does not falsely claim remote deletion'],
 [ui, /Retry server discard/, 'User can request explicit second attempt'],
 [server, /app\.delete\("\/api\/uploads\/:uploadId"/, 'Canonical route implements deletion'],
];
let passed=0;
for(const [body, pattern, desc] of checks){assert.match(body,pattern,desc);passed++;}
assert.doesNotMatch(qt, /cleanupUploadSession/);passed++;
assert.match(qth,/void retryDiscardCancelledUpload\(const QString &transferId\)/);passed++;
console.log(`${passed}/${passed} canceled-upload disposition source contracts passed`);
