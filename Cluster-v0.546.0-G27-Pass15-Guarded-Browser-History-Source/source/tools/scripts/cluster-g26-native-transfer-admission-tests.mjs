import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const read=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const broker=read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const manager=read('apps/desktop-qt/src/TransferManager.cpp');
const api=read('apps/server/src/app/server-routes-media-whiteboards.ts');
const renderer=read('packages/renderer/src/core/desktop.ts');
const policy=read('apps/desktop-qt/src/DesktopTransferRequestPolicy.h');
const checks=[
 ['Qt capability list includes downloadable resources',/QStringLiteral\("transfer.download"\),/.test(broker)],
 ['Qt capability list includes project uploads',/QStringLiteral\("transfer.uploadProjectFile"\),/.test(broker)],
 ['Qt broker validates download payload field allowlist',/\{QStringLiteral\("transfer.download"\), \{QStringLiteral\("url"\), QStringLiteral\("fileName"\), QStringLiteral\("checksumSha256"\)\}\}/.test(broker)],
 ['Qt broker validates project upload field allowlist',/\{QStringLiteral\("transfer.uploadProjectFile"\), \{QStringLiteral\("handle"\), QStringLiteral\("projectId"\)/.test(broker)],
 ['renderer previously expected upload capability',/"transfer.uploadProjectFile"/.test(renderer)],
 ['renderer previously expected download capability',/"transfer.download"/.test(renderer)],
 ['both queue admissions check native session',/m_controller->nativeSessionReady\(\)/.test(broker)],
 ['both queue admissions require writer lease',/if \(!manager->ownsQueue\(\)\)/.test(broker)],
 ['download admission denies non-Cluster resource URLs',/sameServerApiPath\(url.toStdString\(\)\)/.test(broker)],
 ['download request refused if durable queue admission fails',/const QString id = manager->startDownload\(url, name, sha\);[\s\S]*?if \(id.isEmpty\(\)\)/.test(broker)],
 ['download uses native queue path with checksum pin',/manager->startDownload\(url, name, sha\)/.test(broker)],
 ['download request is also checked in queue manager',/sameServerApiPath\(remotePath.toStdString\(\)\)/.test(manager)],
 ['saved journal cannot bypass origin-bound request check',/sameServerApiPath\(remote.toString\(\).toStdString\(\)\)/.test(manager)],
 ['network downloader does not follow redirects',/QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy/.test(manager)],
 ['Qt uploads resolve opaque native handles not renderer paths',/resolveHandle\(handle\)/.test(broker) && /canonicalExistingPath\(record->path, false\)/.test(broker)],
 ['file symlinks or directory handles denied',/record->directory \|\| QFileInfo\(record->path\).isSymLink\(\)/.test(broker)],
 ['project identifiers constrained before server route construction',/safeProjectId\.match\(projectId\)\.hasMatch\(\)/.test(broker)],
 ['upload metadata includes server-verified size',/body.insert\(QStringLiteral\("sizeBytes"\), double\(file.size\(\)\)\)/.test(broker)],
 ['upload metadata includes bounded tags',/toArray\(\).size\(\) > 40/.test(broker)],
 ['native uploader uses canonical project-files finalization endpoint',/QStringLiteral\("\/api\/projects\/%1\/files"\)/.test(broker)],
 ['server endpoint requires project contribution',/authorization.requireProjectResource\(request, reply, project, "library", "contribute"\)/.test(api)],
 ['server endpoint requires verified upload ID',/uploadId: z.string\(\).uuid\(\)/.test(api)],
 ['upload queue admission returns only after durable commit',/const QString id = manager->startUpload\(filePath,[\s\S]*?if \(id.isEmpty\(\)\)/.test(broker)],
 ['native broker does not silently invent evidence associations',/evidenceIntent = \{\{/.test(broker) && /TRANSFER_EVIDENCE_INTENT_INVALID/.test(broker) && /body.toVariantMap\(\), evidenceIntent/.test(broker)],
 ['recovered upload session must be a strict UUID',/validUploadId\(session.toString\(\).toStdString\(\)\)/.test(manager)],
 ['new upload session ID checked before saving',/validUploadId\(sessionId.toStdString\(\)\)/.test(manager)],
 ['recovered upload finalization path constrained',/projectFileFinalizationPath\(finalize.toString\(\).toStdString\(\)\)/.test(manager)],
 ['uploads validate session/destination before creating request',/TRANSFER_SESSION_PATH_INVALID/.test(manager)],
 ['untrusted renderer finalize path refused at queue admission',/projectFileFinalizationPath\(finalizePath.toStdString\(\)\)/.test(manager)],
 ['request path policy has no Qt imports',!/#include\s*[<"]Q/.test(policy)],
];
for(const [name,ok] of checks)assert.ok(ok,name);
const work=mkdtempSync(join(tmpdir(),'cluster-transfer-request-'));
try {
 const exec=join(work,'policy-test');
 const build=spawnSync('g++',['-std=c++20','-Wall','-Wextra','-Werror','-pedantic',new URL('../../apps/desktop-qt/tests/transfer_request_policy_test.cpp',import.meta.url).pathname,'-o',exec],{encoding:'utf8'});
 assert.equal(build.status,0,`request policy build: ${build.stderr}`);
 const result=spawnSync(exec,[],{encoding:'utf8'});
 assert.equal(result.status,0,`request policy execution: ${result.stderr}`);
 assert.match(result.stdout,/PASS 38 origin-bound native transfer request assertions/);
}finally{rmSync(work,{recursive:true,force:true});}
console.log(`${checks.length+38}/${checks.length+38} native transfer admission and origin-bound request assertions passed`);
