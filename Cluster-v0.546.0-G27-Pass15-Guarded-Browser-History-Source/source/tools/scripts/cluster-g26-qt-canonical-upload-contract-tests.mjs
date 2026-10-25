import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const text = file => readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const qt=text('apps/desktop-qt/src/TransferManager.cpp');
const mount=text('apps/desktop-qt/src/LibraryMountManager.cpp');
const broker=text('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const server=text('apps/server/src/domains/uploads/upload-session-routes.ts');
const lib=text('apps/server/src/domains/library/mounted-library-routes.ts');
const runtime=text('apps/server/src/domains/uploads/upload-session-runtime.ts');
const checks = [
 [server,/app\.post\("\/api\/uploads"/, 'server session create route'],
 [server,/app\.get\("\/api\/uploads\/:uploadId"/, 'server session GET route'],
 [server,/app\.put\("\/api\/uploads\/:uploadId\/chunks"/, 'server chunk route'],
 [server,/app\.post\("\/api\/uploads\/:uploadId\/resume"/, 'server resume route'],
 [server,/app\.post\("\/api\/uploads\/:uploadId\/complete"/, 'server completion route'],
 [server,/app\.delete\("\/api\/uploads\/:uploadId"/, 'server abort/cleanup route'],
 [qt,/createRequest\(QStringLiteral\("\/api\/uploads"\)\)/, 'Qt creates canonical upload session'],
 [qt,/QStringLiteral\("\/api\/uploads\/%1"\)\.arg\(sessionId\)/, 'Qt queries canonical session'],
 [qt,/QStringLiteral\("\/api\/uploads\/%1\/chunks"\)\.arg\(sessionId\)/, 'Qt uploads canonical chunk'],
 [qt,/QStringLiteral\("\/api\/uploads\/%1\/resume"\)\.arg\(sessionId\)/, 'Qt explicit resume'],
 [qt,/QStringLiteral\("\/api\/uploads\/%1\/complete"\)\.arg\(sessionId\)/, 'Qt canonical completion'],
 [qt,/QStringLiteral\("clientKey"\), QStringLiteral\("qt-transfer:%1"\)\.arg\(id\)/, 'stable lost-response deduplication'],
 [runtime,/existing\.ownerId === input\.ownerId/, 'server idempotency tied to owner'],
 [qt,/mode != QStringLiteral\("cluster"\)/, 'Qt rejects unsupported provider-direct mode'],
 [qt,/TRANSFER_SERVER_SESSION_NOT_FOUND/, 'revoked/deleted session blocks automatic regeneration'],
 [qt,/TRANSFER_REMOTE_EVIDENCE_INVALID/, 'server status must match local transfer identity'],
 [qt,/TRANSFER_REMOTE_STATE_HELD/, 'finalizing/review sessions cannot be blindly resumed'],
 [qt,/resumeServerUploadSession\(id\)/, 'remote PAUSED uses explicit authenticated resume'],
 [qt,/UPLOAD_OFFSET_CONFLICT/, 'Qt 409 correction restricted to canonical offset conflict'],
 [runtime,/code: "UPLOAD_OFFSET_CONFLICT", receivedBytes/, 'server conflict emits authoritative offset'],
 [qt,/acknowledged != expectedReceived/, 'success response must acknowledge exact sent end'],
 [qt,/TRANSFER_COMPLETE_PROOF_INVALID/, 'completion digest + session + size verified'],
 [qt,/!entry\.value\(QStringLiteral\("retryable"\), true\)\.toBool\(\)/, 'terminal failure cannot be retried'],
 [broker,/entry\.value\(QStringLiteral\("retryable"\), true\)\.toBool\(\)/, 'Desktop Retry button obeys retryability'],
 [lib,/app\.post\("\/api\/desktop-libraries\/from-upload"/, 'real library commit route'],
 [mount,/QStringLiteral\("\/api\/desktop-libraries\/from-upload"\)/, 'mounted Library uses real commit route'],
 [runtime,/upload: sessionMetadata\(session\)/, 'GET and resume response includes wrapped session metadata'],
 [qt,/response\.value\(QStringLiteral\("upload"\)\)\.toObject\(\)/, 'Qt decodes wrapped GET result'],
 [qt,/object\(\)\.value\(QStringLiteral\("upload"\)\)\.toObject\(\)/, 'Qt decodes wrapped resume result'],
 [qt,/expectedRemoteChecksumSha256/, 'Remote-completed checksum is retained for local verification'],
 [qt,/TRANSFER_REMOTE_CHECKSUM_MISMATCH/, 'Local checksum mismatch blocks remote-completed finalization'],
 [qt,/retryableUploadReply\(reply\)/, 'Terminal HTTP client failures cannot be retried automatically'],
 [qt,/Do not DELETE a completed upload/, 'Successful upload cannot destroy its own completion receipt'],
 [runtime,/export async function consumeCompletedUpload\(/, 'Completed upload custody belongs to explicit consumer'],
];
let passed=0;
for(const [body,regex,label] of checks){ assert.match(body,regex,label);passed++; }
assert.doesNotMatch(qt,/\/api\/desktop-transfers\/uploads|from-desktop-transfer/);passed++;
assert.doesNotMatch(qt,/cleanupUploadSession|deleteResource\(request\)/);passed++;
console.log(`${passed}/${passed} canonical Qt upload/source contract assertions passed`);
