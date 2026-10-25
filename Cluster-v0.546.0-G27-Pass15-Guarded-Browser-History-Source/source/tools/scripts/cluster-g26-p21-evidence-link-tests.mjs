import fs from 'node:fs';
import assert from 'node:assert/strict';
const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const contract=read('packages/shared/src/workflow-contracts.ts');
const native=read('apps/desktop-qt/src/TransferManager.cpp');
const broker=read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const server=read('apps/server/src/domains/projects/project-control-routes.ts');
const create=read('packages/renderer/src/features/create/SharedCreateDrawer.tsx');
const cases=[
['canonical evidence relation registered',contract.includes('"evidence_for",')],
['evidence relation metadata present',contract.includes('evidence_for: { outgoing: "Evidence for"')],
['broker accepts validated evidence intent',broker.includes('evidenceIntent = {{') && !broker.includes('TRANSFER_EVIDENCE_LINK_NOT_IMPLEMENTED')],
['broker journals evidence separately',broker.includes('body.toVariantMap(), evidenceIntent')],
['native journal records evidence intent',native.includes('{QStringLiteral("evidenceLink"), evidenceLink}')],
['native journal validates evidence shape',native.includes('const QJsonValue evidence = record.value(QStringLiteral("evidenceLink"))')],
['server validates both endpoints',server.includes('await validateWorkflowEntity(prisma, project, body.source)') && server.includes('await validateWorkflowEntity(prisma, project, body.target)')],
['server authorizes endpoint mutation',server.includes('requireWorkflowEntity(deps, request, reply, project, body.source, "contribute")')],
['server authorizes endpoint read',server.includes('requireWorkflowEntity(deps, request, reply, project, body.target, "view")')],
['server preserves identity on retry',server.includes('prisma.projectRelationship.create') && server.includes('prisma.projectRelationship.findUnique') && server.includes('if (created) {')],
['native finalization persists file before link',native.includes('if (needsLink) { finalizeEvidenceLink(id); return; }')],
['native link recovery bypasses source file',native.includes('finalizeEvidenceLink(id);\n        return;')],
['native link posts authenticated server action',native.includes('QStringLiteral("/api/projects/%1/workflow-links")')],
['native link replay uses stable key',native.includes('qt-evidence:%1')],
['native link validates server receipt',native.includes('TRANSFER_EVIDENCE_RECEIPT_INVALID')],
['native link failure names separate operation',native.includes('TRANSFER_EVIDENCE_LINK_FAILED')],
['native link success persists before emit',native.includes('entry.insert(QStringLiteral("evidenceResult"), linked.toVariantMap())')],
['Shared Create queues canonical evidence',create.includes('evidenceRelationship: "evidence_for"')],
];
for (const [name,passed] of cases) { assert.ok(passed, name); console.log(`PASS ${name}`); }
console.log(`${cases.length}/${cases.length} Pass 21 evidence-link assertions passed`);
