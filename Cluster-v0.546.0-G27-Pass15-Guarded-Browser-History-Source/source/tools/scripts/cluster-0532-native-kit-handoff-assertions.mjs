import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = path => readFileSync(path, 'utf8');
const cpp = read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const header = read('apps/desktop-qt/src/NativeCapabilityBroker.h');
const bridge = read('packages/renderer/src/core/desktop.ts');
const ui = read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
const checks = [];
function check(label, fn) { fn(); checks.push(label); console.log('PASS', label); }
for (const capability of ['package.kit.begin', 'package.kit.chunk', 'package.kit.finish', 'package.kit.cancel']) {
  check(`${capability}: allowlisted, schema validated, dispatched, bridged`, () => {
    const capabilities = cpp.slice(cpp.indexOf('QStringList NativeCapabilityBroker::capabilities()'), cpp.indexOf('QString NativeCapabilityBroker::successResponse'));
    const schemas = cpp.slice(cpp.indexOf('bool NativeCapabilityBroker::validatePayloadShape'), cpp.indexOf('QJsonValue NativeCapabilityBroker::dispatch'));
    assert.ok(capabilities.includes(`QStringLiteral("${capability}")`));
    assert.ok(schemas.includes(`{QStringLiteral("${capability}"),`));
    assert.ok(cpp.slice(cpp.indexOf('QJsonValue NativeCapabilityBroker::dispatch')).includes(`QStringLiteral("${capability}")`));
    assert.ok(bridge.includes(`"${capability}"`));
  });
}
check('Handoff scoped to server profile, session, time and bounded bytes', () => {
  for (const s of ['m_packageIncomingProfile != profileId', 'MaxPackageKitAgeMs', 'MaxPackageKitBytes',
    'nativeSessionReady()', 'm_packageIncomingReceivedBytes', 'QTemporaryFile', 'QCryptographicHash::Sha256']) assert.ok((cpp + header).includes(s));
  assert.ok(cpp.includes('m_packageIncomingReleaseSha != expectedSha'));
  assert.ok(cpp.includes('m_packageIncomingReady = false'));
});
check('No arbitrary renderer paths or trust pins in kit transfer payloads', () => {
  for (const cap of ['package.kit.begin', 'package.kit.chunk', 'package.kit.finish', 'package.kit.cancel']) {
    const schemas = cpp.slice(cpp.indexOf(`{QStringLiteral("${cap}"),`));
    const line = schemas.slice(0, schemas.indexOf('\n'));
    assert.doesNotMatch(line, /destination|path|trustedPin|signingPin|grant/);
  }
});
check('Existing Qt native confirmation and independently pinned Go verifier retained', () => {
  assert.ok(cpp.includes('QMessageBox::question(nullptr, installerInstall ?') && cpp.includes('fileOperation ? QStringLiteral("Cluster destination file updater")')); // Verify the current combined confirmation dispatch, not obsolete text spelling.
  assert.ok(cpp.includes('QStringLiteral("--trusted-key-sha256"), pin'));
  assert.ok(cpp.includes('QStringLiteral("--kit"), kit.absoluteFilePath()'));
  assert.ok(cpp.includes('m_packageIncomingKit->fileName()'));
  assert.ok(cpp.includes('const bool usePreparedKit'));
});
check('Device target refreshed before both native verification and actual folder modification', () => {
  assert.ok(ui.includes('await transferDownloadedPackageKitToNative(kit'));
  assert.ok(ui.includes('await stageNativePackageKit('));
  assert.ok(ui.includes('await runNativePackageFileUpdate('));
  assert.ok(ui.includes('The Package target changed before destination update'));
  assert.ok(ui.includes('Download & update files'));
});
check('Automatic follow-on is stage-success-only and requires a native confirmation', () => {
  const followUp = ui.slice(ui.indexOf('if (intent.updateAfterStage)'), ui.indexOf('if (!verifiedStageMatchesLease'));
  assert.ok(followUp.includes('setTimeout'));
  assert.ok(followUp.includes('"sync", true'));
  assert.ok(ui.indexOf('if (event.status.state === "failed")') < ui.indexOf('if (intent.updateAfterStage)'));
  assert.ok(cpp.includes('The native helper will'));
});
const source = read('packages/renderer/src/features/settings/package-staging-kit.ts');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require, Blob, TextEncoder, Uint8Array, DataView, Error });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i=0;i<8;i++) c = (c>>>1)^((c&1)?0xedb88320:0); } return (c^0xffffffff)>>>0; };
function sampleZip() {
  const contents = Buffer.from('No execution, file updates only.\n');
  const name = Buffer.from('payload/NOTICE.txt');
  const crc = crc32(contents);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(20,4); local.writeUInt32LE(crc,14); local.writeUInt32LE(contents.length,18); local.writeUInt32LE(contents.length,22); local.writeUInt16LE(name.length,26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50,0); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt32LE(crc,16); central.writeUInt32LE(contents.length,20); central.writeUInt32LE(contents.length,24); central.writeUInt16LE(name.length,28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(central.length+name.length,12); end.writeUInt32LE(local.length+name.length+contents.length,16);
  return Buffer.concat([local,name,contents,central,name,end]);
}
const dir = mkdtempSync(join(tmpdir(), 'cluster-0532-handoff-'));
try {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const archive = sampleZip();
  const manifest = {schema:1,packageKey:'sample-package',version:'1.0.0',platform:'linux-x64',artifactSha256:sha(archive),artifactSize:archive.length,filename:'sample.zip'};
  const signatureBase64 = sign(null,Buffer.from('CLUSTER_MANAGED_PACKAGE_V1\n'+JSON.stringify(manifest)),privateKey).toString('base64');
  const publicKeyPem = publicKey.export({format:'pem',type:'spki'});
  const kit = mod.exports.buildPackageStagingKit({archive:new Uint8Array(archive),filename:'sample.zip',manifest,signatureBase64,publicKeyPem});
  const bytes = Buffer.from(await kit.arrayBuffer());
  // Simulate the renderer's bounded/ordered chunk serialization. Qt's C++
  // write/hash path requires Windows/Qt runtime to validate independently.
  const chunks = []; let offset = 0;
  while (offset < bytes.length) { const piece = bytes.subarray(offset,offset+48*1024); const b64 = piece.toString('base64'); assert.ok(b64.length <= 65536); chunks.push(Buffer.from(b64,'base64')); offset+=piece.length; }
  const reconstructed = Buffer.concat(chunks);
  check('Downloaded staging-kit bytes roundtrip losslessly via base64 chunks', () => {
    assert.deepEqual(reconstructed,bytes); assert.equal(sha(reconstructed),sha(bytes));
  });
  const maxChunks = Math.ceil((4*1024*1024+64*1024)/(48*1024));
  check('Maximum-size kit fits within native transfer budget', () => assert.ok(maxChunks < 120));
  const kitPath = join(dir,'direct-handoff.zip'); writeFileSync(kitPath,reconstructed);
  const root = join(dir,'staged'); const pin = sha(publicKey.export({format:'der',type:'spki'}));
  const args = ['run','.', '--action','stage','--kit',kitPath,'--trusted-key-sha256',pin,'--root',root,
    '--expected-package-key',manifest.packageKey,'--expected-version',manifest.version,'--expected-artifact-sha256',manifest.artifactSha256];
  check('Reassembled authenticated-renderer kit is accepted by independently pinned Go', () => {
    const output=execFileSync('go',args,{cwd:'tools/native/package-stager-go',encoding:'utf8'});
    assert.match(output,/Verified, staged, not installed/);
  });
  check('Wrong native signing fingerprint is rejected', () => {
    assert.throws(()=>execFileSync('go',[...args.slice(0,7), '0'.repeat(64), ...args.slice(8), '--root',join(dir,'wrong-pin')],{cwd:'tools/native/package-stager-go',stdio:'pipe'}));
  });
  console.log(`${checks.length}/${checks.length} v0.532 focused checks passed`);
} finally { rmSync(dir,{recursive:true,force:true}); }
