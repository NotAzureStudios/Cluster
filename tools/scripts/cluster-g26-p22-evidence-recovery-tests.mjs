// Execute the production workflow-link POST handler with a controlled Prisma
// identity index. This is not a PostgreSQL certification or a copy of its logic.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';

const read = name => fs.readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
const server = read('apps/server/src/domains/projects/project-control-routes.ts');
const native = read('apps/desktop-qt/src/TransferManager.cpp');
const broker = read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const center = read('packages/renderer/src/features/shell/TaskbarTransferCenter.tsx');
const sync = read('packages/renderer/src/components/SyncStatusIndicator.tsx');
const types = read('packages/renderer/src/core/desktop.ts');
const marker = '  app.post("/api/projects/:projectId/workflow-links", async (request, reply) => {';
const start = server.indexOf(marker);
const end = server.indexOf('\n  });', start + marker.length);
assert.ok(start >= 0 && end > start, 'production workflow POST handler exists');
const body = server.slice(start + marker.indexOf('async (request, reply) => {'), end) + '\n}';
const compiled = stripTypeScriptTypes(`const routeHandler = ${body};`, { mode:'transform' });
const names = ['getCurrentUser', 'z', 'workflowLinkInputSchema', 'ensureProject', 'enforceTargetAccess',
  'validateWorkflowEntity', 'requireWorkflowEntity', 'cardRelationshipGraphDiagnostic', 'createHttpError',
  'deps', 'prisma', 'syncWorkflowLibraryBacklinks', 'logActivity', 'serializeProjectRelationship'];
const factory = Function(...names, `"use strict"; ${compiled}\nreturn routeHandler;`);
const staticChecks = [
  ['journal checks relation/target kind before replay', native.includes('const QJsonObject intent = evidence.toObject()') && native.includes('safeId.match(targetId)')],
  ['journal checks bound file identity and checksum', native.includes('savedFile.value(QStringLiteral("checksumSha256"))') && native.includes('savedFile.value(QStringLiteral("sizeBytes"))')],
  ['journal rejects complete evidence without link receipt', native.includes('state == QStringLiteral("complete") && linked.isEmpty()')],
  ['journal checks link receipt against source file/target', native.includes('linked.value(QStringLiteral("sourceId"))') && native.includes('linked.value(QStringLiteral("targetId"))')],
  ['server retry preserves original creator', server.includes('if (created) {') && !body.includes('projectRelationship.upsert')],
  ['native projection distinguishes file creation and linking', broker.includes('QStringLiteral("fileSaved")') && broker.includes('QStringLiteral("evidenceStatus")')],
  ['native projection exposes pending linking stage', broker.includes('QStringLiteral("linking-evidence")')],
  ['native committing can be paused', broker.includes('state == QStringLiteral("committing")));')],
  ['renderer types expose stage and saved-file proof', types.includes('fileSaved?: boolean;') && types.includes('evidenceStatus?:')],
  ['native pushes queue state along with transfer items', broker.includes('QStringLiteral("queueStatus")') && types.includes('queueStatus?: ClusterNativeTransferQueueStatus')],
  ['native push replaces redundant list/status polling', center.includes('nativeRefreshGeneration.current.invalidate();') && center.includes('setNativeTransfers(event.items || [])') && sync.includes('setNativeTransfers(event.items || [])')],
  ['native profile changes fence stale push events', types.includes('event.profileId !== nativeBrokerContext.profileId')],
  ['Transfer Center reports independent completion stages', center.includes('File saved · linking evidence') && center.includes('Retry link')],
  ['stopped linking remains visible until explicitly dismissed', center.includes('item.state === "cancelled" && item.fileSaved') && center.includes('removeNativeTransfer(transfer.id)') && broker.includes('evidence-link-cancelled')],
  ['Sync Center does not pretend evidence failure is upload failure', sync.includes('The Project file is retained. Only relationship linking remains.')],
];
let assertions = 0;
for (const [name, ok] of staticChecks) { assert.ok(ok, name); assertions++; console.log(`PASS ${name}`); }

const rows = new Map();
const activity = [];
const backed = [];
let validationCalls = 0;
let authorizationCalls = 0;
let sequence = 0;
let failureMode = '';
const keyFor = o => [o.projectId,o.sourceType,o.sourceId,o.targetType,o.targetId,o.relationship].join(':');
const prisma = {projectRelationship: {
  async create({data}) {
    if (failureMode === 'create-failure') throw Object.assign(new Error('database unavailable'), {code:'P1001'});
    await Promise.resolve(); // force identical requests to interleave
    const key = keyFor(data);
    if (rows.has(key)) throw Object.assign(new Error('duplicate unique identity'), {code:'P2002'});
    const record = {...data,id:`relationship-${++sequence}`};
    rows.set(key, record);
    return record;
  },
  async findUnique({where}) {
    if (failureMode === 'phantom-constraint') return null;
    return rows.get(keyFor(where.projectId_sourceType_sourceId_targetType_targetId_relationship)) || null;
  },
}};
const makeHandler = () => factory(
  async request => ({id:request.userId || 'owner'}),
  {string:()=>({}),object:() => ({parse: x=>x})},
  {parse:x=>x},
  async (_, projectId) => ({id:projectId}),
  async (_req, _reply) => {authorizationCalls++;return failureMode !== 'access-denied';},
  async () => {validationCalls++;},
  async () => true,
  async () => null,
  (code,message,status) => Object.assign(new Error(message),{code,status}),
  {}, prisma,
  async (_db, record) => {backed.push(record.id);},
  async record => {activity.push(record);},
  x=>x,
);
const handler=makeHandler();
const args=(userId='owner', description='initial evidence')=>[{
  userId, params:{projectId:'project-a'}, body:{source:{kind:'file',id:'file-a',projectId:'project-a'},target:{kind:'ticket',id:'ticket-b',projectId:'project-a'},relationship:'evidence_for',description,critical:false},
}, {code(n){this.status=n;return this;},send(data){this.body=data;}}];
const [one,two]=await Promise.all([handler(...args()),handler(...args('another-user','mutated retry'))]);
assert.equal(one.id,two.id,'two concurrent duplicate requests return one relationship');assertions++;
assert.equal(rows.size,1,'unique identity guarantees one row');assertions++;
assert.equal(activity.length,1,'exactly one create activity event');assertions++;
assert.equal(one.createdById,'owner','creator identity is stable');assertions++;
assert.equal(two.description,'initial evidence','replay cannot mutate relationship metadata');assertions++;
const replay=await handler(...args('third-user','changed again'));
assert.equal(replay.id,one.id,'lost-response replay returns original receipt');assertions++;
assert.equal(activity.length,1,'replay produces no duplicate activity');assertions++;
assert.equal(backed.length,3,'idempotent back-link repair runs on replays');assertions++;
assert.equal(validationCalls,6,'both endpoints validated on every replay');assertions++;
assert.ok(authorizationCalls>=3,'project access rechecked on every replay');assertions++;
failureMode='create-failure';
await assert.rejects(handler(...args('owner','new')),(error)=>error.code==='P1001','non-unique database failure remains failure');assertions++;
failureMode='phantom-constraint';
await assert.rejects(handler(...args()), (error)=>error.code==='P2002','unique error without matching identity remains failure');assertions++;
failureMode='access-denied';
const deniedReply=args()[1];await handler(args()[0], deniedReply);
assert.equal(authorizationCalls>=4,true,'denied replay checks access before reading existing row');assertions++;
assert.equal(activity.length,1,'no audit side-effects on denied request');assertions++;
failureMode='';
console.log(`${assertions}/${assertions} G26 Pass 22 source + executed concurrency/replay assertions passed`);
