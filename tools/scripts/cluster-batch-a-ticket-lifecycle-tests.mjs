#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isClosedTicketStage, isClosedBoardWorkItem } from '../../packages/shared/src/ticket-stage-contract.ts';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = file => readFileSync(resolve(root, file), 'utf8');
let count = 0;
function check(label, run) { run(); count++; console.log(`PASS ${label}`); }
for (const stage of [undefined, null, '', 'new', 'accepted', 'working', 'waiting', 'review', 'RESOLVED', 'unknown']) {
  for (const listIsDone of [true, false]) check(`Ticket ${String(stage)} stays open in ${listIsDone?'done':'active'} List`, () => {
    assert.equal(isClosedTicketStage(stage), false);
    assert.equal(isClosedBoardWorkItem({ workItemKind: 'ticket', ticketStage: stage, listIsDone, listTitle: 'Done' }), false);
  });
}
for (const stage of ['resolved', 'rejected']) for (const listIsDone of [true, false]) check(`Ticket ${stage} closed independently of List`, () => {
  assert.equal(isClosedTicketStage(stage), true);
  assert.equal(isClosedBoardWorkItem({ workItemKind: 'ticket', ticketStage: stage, listIsDone, listTitle: 'Backlog' }), true);
});
check('Ordinary Cards retain Board completion and explicit List conventions', () => {
  assert.equal(isClosedBoardWorkItem({ workItemKind: 'card', listIsDone: true, listTitle: 'Backlog' }), true);
  assert.equal(isClosedBoardWorkItem({ workItemKind: 'card', listIsDone: false, listTitle: 'Done' }), true);
  assert.equal(isClosedBoardWorkItem({ workItemKind: 'card', listIsDone: false, listTitle: 'Review' }), false);
});
check('Both Ticket APIs return canonical stage completion and separate physical Board placement', () => {
  const routes = read('apps/server/src/domains/tickets/ticket-routes.ts');
  assert.equal((routes.match(/listIsDone: isClosedTicketStage\(card\.ticketStage\)/g) || []).length, 2);
  assert.equal((routes.match(/boardListIsDone: Boolean\(card\.list\.isDone\)/g) || []).length, 2);
  assert.doesNotMatch(routes, /listIsDone: card\.ticketStage \?/);
});
check('Ticket Search, triage, waiting and review use authoritative stage only', () => {
  const ui = read('packages/renderer/src/features/tickets/TicketSystemPage.tsx');
  assert.match(ui, /isClosedTicketStage\(card\.ticketStage\)/);
  assert.match(ui, /!card\.ticketStage \|\| card\.ticketStage === "new"/);
  assert.match(ui, /card\.ticketStage === "waiting"/);
  assert.match(ui, /card\.ticketStage === "review"/);
  assert.doesNotMatch(ui, /card\.ticketStage \? \["resolved", "rejected"\]/);
});
check('Taskbar Tickets use stage rather than List fallback', () => {
  const ui = read('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
  assert.match(ui, /isClosedTicketStage\(card\.ticketStage\)/);
});
check('Issues and Project QA use common mixed Card/Ticket logic', () => {
  for (const path of ['ProjectIssuesPanel.tsx', 'ProjectQAPanel.tsx']) {
    const source = read(`packages/renderer/src/features/projects/${path}`);
    assert.match(source, /isClosedBoardWorkItem\(/);
  }
});
check('Blank Boards and Ticket destinations stay independent', () => {
  const service = read('apps/server/src/domains/boards/board-service.ts');
  const repo = read('apps/server/src/domains/boards/board-repository.ts');
  assert.match(service, /body\.columns \?\? \[\]/);
  assert.match(repo, /columns\.length \? \{ lists:/);
  const ticket = read('apps/server/src/domains/tickets/ticket-data-query.ts');
  assert.match(ticket, /ticketStage: \{ in: \["resolved", "rejected"\] \}/);
});
check('QA coverage and Operations counts use the shared mixed Card/Ticket lifecycle', () => {
  const coverage = read('packages/renderer/src/features/projects/ProjectQaCoveragePanel.tsx');
  const operations = read('packages/renderer/src/features/operations/modules/operations-delivery.tsx');
  assert.match(coverage, /isClosedBoardWorkItem\(\{ \.\.\.card, listIsDone: doneListIds\.has\(card\.listId\) \}\)/);
  assert.match(operations, /!isClosedBoardWorkItem\(card\)/);
});
check('Mixed Project QA and Issue closed queues are not mislabeled resolved', () => {
  const qa = read('packages/renderer/src/features/projects/ProjectQAPanel.tsx');
  const issues = read('packages/renderer/src/features/projects/ProjectIssuesPanel.tsx');
  assert.match(qa, /<span>Closed<\/span><strong>\{closed\.length\}/);
  assert.match(issues, /label: "Closed", value: closed\.length/);
});
console.log(`Batch A Ticket lifecycle: ${count}/${count} passed`);
