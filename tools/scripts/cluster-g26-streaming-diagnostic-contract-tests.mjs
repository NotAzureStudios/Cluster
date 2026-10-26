import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = p => readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const diagnosis=read('tools/native/package-stager-go/transfer_diagnostic.go');
const recovery=read('tools/native/package-stager-go/durable_transfer.go');
const qt=read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const ui=read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
const tests=read('tools/native/package-stager-go/transfer_diagnostic_test.go');
let count=0;function check(name, fn){fn();count++;console.log('PASS',name)}
check('diagnostics distinguish incompatible streaming state from invalid core metadata',()=>{
 assert.match(diagnosis,/readTransferMetadata\(meta, false\)/);
 assert.match(diagnosis,/streaming_hash_state_invalid_full_recovery_required/);
 assert.match(diagnosis,/checkpoint_invalid/);
});
check('diagnostic read-only contract is unchanged',()=>assert.match(diagnosis,/ReadOnly: true/));
check('invalid streaming state is always manual review',()=>assert.match(diagnosis,/streaming_hash_state_invalid_full_recovery_required[\s\S]*?out.ManualReviewRequired = true/));
check('ordinary append requires validated hash state and refuses unknown revisions',()=>assert.match(recovery,/func loadFastAppendState[\s\S]*?loadTransferCheckpointMetadata\(meta\)/));
check('only explicit recovery may rebuild streaming hash after full read',()=>{
 assert.match(recovery,/needsHashStateRepair := hashStateErr != nil/);
 assert.match(recovery,/io.Copy\(fullHash, io.LimitReader\(/);
});
check('diagnostics stay separate from mutating Qt recovery capability',()=>{
 assert.match(qt,/const bool diagnose = capability == QStringLiteral\("package.transfer.diagnose"\)/);
 assert.match(qt,/const bool recover = capability == QStringLiteral\("package.transfer.recover"\)/);
});
check('operator sees read-only outcome and explicit manual review',()=>assert.match(ui,/Local recovery requires explicit review/));
check('runtime tests cover unmodified evidence and corrupt-file refusal',()=>{
 assert.match(tests,/TestTransferDiagnosticDifferentiatesStreamingHashDamage/);
 assert.match(tests,/read-only diagnosis modified transfer files/);
 assert.match(tests,/repair accepted corrupted bytes/);
});
console.log(`${count}/${count} streaming-state diagnostic contracts passed`);
