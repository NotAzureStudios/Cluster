#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const r=path=>readFileSync(path,'utf8');let checks=0;
function test(label,fn){fn();checks++;console.log('PASS G26 provider fence',label)}
const types=r('apps/server/src/core/storage/storage-types.ts');
const s3=r('apps/server/src/core/storage/s3-storage-provider.ts');
const upload=r('apps/server/src/domains/uploads/upload-session-runtime.ts');
const safety=r('apps/server/src/core/storage/storage-disposition-safety.ts');
const runtime=r('apps/server/src/core/storage/storage-lifecycle-runtime.ts');
test('provider stat may report opaque S3 generation but does not imply lease',()=>{
 assert.match(types,/providerVersionId\?: string \| null/);
 assert.match(s3,/response\.headers\["x-amz-version-id"\]/);
 assert.match(s3,/rawVersionId !== "null"/);
 assert.match(s3,/return \{ size, modifiedAt, checksumSha256, providerVersionId \}/);
});
test('operator inspection never exposes raw provider version tokens',()=>{
 assert.match(upload,/providerVersionIdentity: stat\.providerVersionId \? "observed_unfenced" : "unavailable"/);
 assert.match(upload,/providerGenerationFenceEstablished: false/);
 assert.doesNotMatch(upload,/providerVersionId: stat\.providerVersionId/);
});
test('version evidence is never promoted into a delete permit',()=>{
 assert.match(safety,/safePhysicalDelete: false/);
 assert.match(safety,/No provider-level reversible, generation-fenced quarantine API/);
 assert.match(safety,/Cluster does not hold a lease or enforce conditional mutation/);
 assert.match(runtime,/const gcDeleted = 0/);
 assert.match(runtime,/const migrated = 0/);
});
test('provider mutations remain unconditional and forbidden by lifecycle',()=>{
 assert.match(s3,/async delete\(key: string\)/);
 assert.doesNotMatch(runtime,/await this\.storage\.delete\(/);
 assert.doesNotMatch(runtime,/await this\.storage\.copy\(/);
});
console.log(`G26 provider generation evidence: ${checks}/${checks} passed`);
