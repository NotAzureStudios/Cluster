import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = (path) => readFileSync(new URL('../../'+path, import.meta.url), 'utf8');
const native = read('tools/native/package-stager-go/durable_transfer.go');
const tests = read('tools/native/package-stager-go/transfer_streaming_hash_test.go');
const renderer = read('packages/renderer/src/core/desktop.ts');
const qt = read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
let passed = 0;
function check(description, fn) { fn(); console.log('PASS',description);passed++; }
check('checkpoint schema is explicitly updated',()=>assert.match(native,/transferCheckpointSchema = 2/));
check('persisted sha256 state is checked for exact byte count',()=>assert.match(native,/binary\.BigEndian\.Uint64\(raw\[len\(raw\)-8:\]\) != uint64\(state\.ReceivedBytes\)/));
check('stored streaming state must match prior published prefix digest',()=>assert.match(native,/hex\.EncodeToString\(hasher\.Sum\(nil\)\) != state\.PrefixSha256/));
check('append has a bounded 64 KiB trailing evidence check',()=>assert.match(native,/transferTailWindow int64 = 64 \* 1024/));
check('append implementation does not call full prefix verifier',()=>{
 const code=native.slice(native.indexOf('func appendTransfer('),native.indexOf('func commitTransfer('));
 assert.doesNotMatch(code,/readTransferCheckpoint\(/);
 assert.match(code,/loadFastAppendState\(/);
 assert.match(code,/hasher\.Write\(chunk\)/);
 assert.match(code,/transferTailDigest\(f, expected\)/);
 assert.match(code,/f\.Sync\(\)/);
});
check('full independent disk SHA remains required by final commit',()=>{
 const code=native.slice(native.indexOf('func commitTransfer('),native.indexOf('func bindTransferOffer('));
 assert.match(code,/readTransferCheckpoint\(meta, part, archive\)/);
 assert.match(code,/state\.PrefixSha256 != digest/);
});
check('manual recovery rebuilds state only after full disk inspection',()=>{
 const code=native.slice(native.indexOf('func recoverTransfer('),native.indexOf('func beginTransfer('));
 assert.match(code,/io\.Copy\(fullHash, io\.LimitReader\(/);
 assert.match(code,/encodeTransferHasher\(fullHash, count\)/);
 assert.match(code,/reconstructed_streaming_hash_state/);
});
check('regular append refuses crash pending metadata',()=>assert.match(native,/incomplete checkpoint publication; explicit recovery required/));
check('native checkpoint is typed as schema 2 in Desktop',()=>assert.match(renderer,/NativePackageTransferCheckpoint = \{\s*schema: 2/));
check('Qt checkpoint parser accepts schema 2 while diagnostic stays on 1',()=>{
  assert.match(qt,/evidence\.value\(QStringLiteral\("schema"\)\)\.toInt\(\) != 2 \/\/ Native transfer checkpoint v2/);
  assert.match(qt,/if \(diagnose\) \{[\s\S]*?evidence\.value\(QStringLiteral\("schema"\)\)\.toInt\(\) != 1/);
});
check('tests exercise undetected middle-file alteration rejected at commit',()=>assert.match(tests,/staged corrupted bytes without mandatory full checksum/));
check('tests exercise repair of corrupted state, receiving and committed',()=>{
 assert.match(tests,/TestStreamingHasherRepairRequiresFullVerifiedRecovery/);
 assert.match(tests,/TestCommittedTransferStreamingStateCanBeExplicitlyRebuilt/);
});
console.log(`${passed}\/${passed} native transfer streaming-hash contracts passed`);
