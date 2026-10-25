import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const qt = read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const ts = read('packages/renderer/src/core/desktop.ts');
const go = read('tools/native/package-stager-go/durable_transfer.go');
let assertions=0;
const check = (title,test)=>{test();console.log('PASS',title);assertions++;};
check('Qt has explicit 512 KiB decoded segment cap',()=>assert.match(qt,/MaxArchiveChunkBytes = 512 \* 1024/));
check('Qt bounds canonical Base64 length from decoded cap',()=>assert.match(qt,/MaxArchiveChunkBase64Bytes = 4 \* \(\(MaxArchiveChunkBytes \+ 2\) \/ 3\)/));
check('Qt requests remain capped even before JSON parsing',()=>assert.match(qt,/MaxArchiveChunkRequestBytes = 768 \* 1024/));
check('Qt payloads remain individually bounded',()=>assert.match(qt,/MaxArchiveChunkPayloadBytes = 736 \* 1024/));
check('Qt validates decoded and round-trip encoded payload sizes',()=>assert.match(qt,/decoded\.decoded\.size\(\) > MaxArchiveChunkBytes[\s\S]*?decoded\.decoded\.toBase64\(\) != encoded/));
check('Renderer uses same segment budget for all native append paths',()=>{
 assert.match(ts,/NATIVE_PACKAGE_ARCHIVE_SEGMENT_BYTES = 512 \* 1024/);
 const uses=ts.match(/NATIVE_PACKAGE_ARCHIVE_SEGMENT_BYTES/g)??[];
 assert.equal(uses.length,5,'one constant and four loop uses');
 assert.doesNotMatch(ts,/384 \* 1024/);
});
check('Go native helper still imposes independent max 4 MiB ceiling',()=>assert.match(go,/maxTransferChunk = 4 \* 1024 \* 1024/));
check('Qt checks native checkpoint schema2 before filtering',()=>{
 assert.ok(qt.indexOf('evidence.value(QStringLiteral("schema")).toInt() != 2') < qt.indexOf('publicCheckpoint.remove(QStringLiteral("hashState"))'));
});
check('Qt strips SHA state, tail hash and disk time before renderer projection',()=>{
 for(const field of ['hashState','tailSha256','payloadModTimeNano'])
  assert.match(qt,new RegExp('publicCheckpoint\\.remove\\(QStringLiteral\\("'+field+'"\\)\\)'));
 assert.match(qt,/return publicCheckpoint; \/\/ No local path, hash internals/);
});
check('Read-only diagnosis maintains its separate schema1 contract',()=>assert.match(qt,/if \(diagnose\) \{[\s\S]*?evidence\.value\(QStringLiteral\("schema"\)\)\.toInt\(\) != 1/));
console.log(`${assertions}/${assertions} Qt transport bounds and redaction checks passed`);
