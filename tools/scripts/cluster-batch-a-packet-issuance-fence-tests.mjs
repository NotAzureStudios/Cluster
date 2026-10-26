#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { commitPacketDeliveryIssuance } from '../../apps/server/src/domains/library/packet-delivery-issuance.ts';

const source = readFileSync(resolve('apps/server/src/domains/library/packet-routes.ts'), 'utf8');
const audienceSource = readFileSync(resolve('apps/server/src/domains/access/studio-audience.ts'), 'utf8');
let count = 0;
async function check(label, test) { await test(); console.log('PASS', label); count++; }
const sha = 'a'.repeat(64);
const release = { id: 'release', packetDefinitionId: 'def', versionLabel: '1.0',
  manifestSha256: sha, manifestJson: JSON.stringify({ audienceJson: '{"mode":"all","targets":[]}' }), revokedAt: null };
function mockDb(data = {}) {
  const current = { ...release, ...data };
  const receipts = [];
  let visits = 0;
  const db = { $transaction: async (callback) => callback({
    $queryRaw: async () => { visits++; return [{ ...current }]; },
    user: { findFirst: async ({where}) => where.id === 'active' ? { id: where.id } : null },
    packetDeliveryReceipt: { create: async ({data}) => { receipts.push(data); return { id: String(receipts.length) }; } },
  }) };
  return { db, receipts, current, get visits() {return visits;} };
}
const input = { packetDefinitionId: 'def', releaseId: 'release', expectedManifestSha256: sha, recipientId: 'active', kind:'artifact', position: 1, derivativeHash: 'b'.repeat(64), sizeBytes: 12,
  verifyRelease: () => true, authorizeRecipient: async () => true };
await check('valid issuance persists exact release, recipient, checksum and byte count', async () => {
  const {db,receipts,visits} = mockDb();
  const result = await commitPacketDeliveryIssuance(db,input);
  assert.equal(result.receiptId,'1'); assert.equal(receipts.length,1); assert.equal(receipts[0].recipientId,'active');
  assert.equal(receipts[0].kind,'artifact'); assert.equal(receipts[0].sizeBytes,12);
});
await check('concurrent revocation wins before issuing: fail closed with no receipt', async () => {
  const ctx = mockDb({ revokedAt:new Date() });
  assert.deepEqual(await commitPacketDeliveryIssuance(ctx.db,input), {conflict:'PACKET_RELEASE_REVOKED'});
  assert.equal(ctx.receipts.length,0);
});
await check('release replacement fingerprint cannot be issued or acknowledged via previous snapshot', async () => {
  const ctx = mockDb({ manifestSha256:'c'.repeat(64) });
  assert.deepEqual(await commitPacketDeliveryIssuance(ctx.db,input), {conflict:'PACKET_RELEASE_CHANGED'});
  assert.equal(ctx.receipts.length,0);
});
await check('corrupt frozen release integrity fails closed', async () => {
  const ctx = mockDb();
  assert.deepEqual(await commitPacketDeliveryIssuance(ctx.db,{...input,verifyRelease:()=>{throw Error('tampered')}}),{conflict:'PACKET_RELEASE_INVALID'});
  assert.equal(ctx.receipts.length,0);
});
await check('missing frozen audience fails closed', async () => {
  const ctx = mockDb({ manifestJson:'{}' });
  assert.deepEqual(await commitPacketDeliveryIssuance(ctx.db,input),{conflict:'PACKET_RELEASE_INVALID'});
  assert.equal(ctx.receipts.length,0);
});
await check('inactive recipient cannot receive a derivative even when outer route checked earlier', async () => {
  const ctx = mockDb();
  assert.deepEqual(await commitPacketDeliveryIssuance(ctx.db,{...input,recipientId:'disabled'}),{conflict:'PACKET_RECIPIENT_UNAVAILABLE'});
  assert.equal(ctx.receipts.length,0);
});
await check('revoked audience entitlement cannot leave a receipt after outer access check', async () => {
  const ctx = mockDb();
  assert.deepEqual(await commitPacketDeliveryIssuance(ctx.db,{...input,authorizeRecipient:async()=>false}),{conflict:'PACKET_RECIPIENT_FORBIDDEN'});
  assert.equal(ctx.receipts.length,0);
});
await check('recipient context failure propagates and no issuance takes place', async () => {
  const ctx=mockDb();
  await assert.rejects(commitPacketDeliveryIssuance(ctx.db,{...input,authorizeRecipient:async()=>{throw Error('db down')}}),/db down/);
  assert.equal(ctx.receipts.length,0);
});
await check('concurrent serializable release change reports a retryable conflict, not a 500', async()=>{
 const db={$transaction:async()=>{throw Object.assign(Error('serialization failure'),{code:'P2034'})}};
 assert.deepEqual(await commitPacketDeliveryIssuance(db,input),{conflict:'PACKET_ISSUANCE_CONCURRENT'});
});
await check('generic database failures remain failures and cannot issue', async()=>{
 const db={$transaction:async()=>{throw Error('database unavailable')}};
 await assert.rejects(commitPacketDeliveryIssuance(db,input),/database unavailable/);
});
await check('both artifact and bundle routes use the transactional issuance fence',async()=>{
  assert.equal((source.match(/await commitPacketDeliveryIssuance\(prisma/g)||[]).length,2);
  assert.equal((source.match(/await prisma\.packetDeliveryReceipt\.create/g)||[]).length,0);
  assert.match(source,/for \(const recipient of currentRecipients\)/);
  assert.match(source,/loadStudioAudienceUserContext\(tx, recipient, \{ strict: true \}\)/);
  assert.match(audienceSource,/loadStudioAudienceUserContext\(prisma, user, \{ strict: true \}\)/);
});
console.log(`Packet issuance/eligibility fence checks ${count}/${count} passed`);
