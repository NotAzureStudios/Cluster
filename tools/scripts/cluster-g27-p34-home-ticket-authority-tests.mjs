import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const ts = require(path.resolve(process.execPath, '../../lib/node_modules/typescript/lib/typescript.js'));
const read = (filename) => fs.readFileSync(path.join(root, filename), 'utf8');
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(read('packages/renderer/src/features/home-widgets/home-ticket-policy.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports });
const { isOpenHomeTicket, isPriorityHomeTicket } = module.exports;
let checks = 0;
const check = (name, fn) => { fn(); console.log('PASS ' + name); checks++; };
for (const stage of [null, 'new', 'accepted', 'working', 'waiting', 'review']) check(`${stage || 'unset'} ticket stays open regardless of list title`, () => {
  assert.equal(isOpenHomeTicket({ticketStage:stage,listTitle:'Done',listIsDone:true}),true);
});
for (const stage of ['resolved', 'rejected', 'RESOLVED']) check(`${stage} ticket closes regardless of list title`, () => {
  assert.equal(isOpenHomeTicket({ticketStage:stage,listTitle:'To Do',listIsDone:false}),false);
});
for (const [priority,stage,expected] of [['urgent','new',true],['high','working',true],['normal','new',false],['high','resolved',false],['urgent','rejected',false]]) check(`Priority count ${priority}/${stage}`, () => {
  assert.equal(isPriorityHomeTicket({priority,ticketStage:stage}), expected);
});
const dashboard = read('packages/renderer/src/features/application/modules/ApplicationDashboard.tsx');
const routes = read('apps/server/src/domains/tickets/ticket-routes.ts');
const builtIn = read('packages/renderer/src/features/home-widgets/BuiltInHomeWidget.tsx');
check('Home uses canonical stage and both status/priority selectors', () => {
  assert.match(dashboard, /homeTickets\.filter\(isOpenHomeTicket\)/);
  assert.match(dashboard, /homeTickets\.filter\(isPriorityHomeTicket\)/);
  assert.doesNotMatch(dashboard,/listIsDone && !\/done/);
});
check('Home retains owner, project and updatedAt metadata for exact filtered lists', () => {
  assert.match(dashboard, /projectId: ticket.projectId, userId: ticket.assigneeId \|\| null, at: ticket.updatedAt \|\| null/);
});
check('Ticket summary requests are explicitly bounded and sampled counters say so', () => {
  assert.match(dashboard,/assigned-summary\?limit=40/);
  assert.match(builtIn,/Loaded \(max 40\)/);
  assert.match(builtIn,/Open in sample/);
});
check('Failed authorization rule lookups cannot turn into a permissive empty list', () => {
  const route = routes.slice(routes.indexOf('app.get("/api/tickets/assigned-summary"'),routes.indexOf('app.get("/api/tickets/workspace"'));
  assert.match(route,/const rules = ruleOr.length \? await prisma.accessRule.findMany/);
  assert.doesNotMatch(route,/accessRule.findMany[^;]*\.catch\(/);
  assert.match(route,/hasTargetAccess\(/);
});
check('Assigned summary selects and returns canonical ticketStage', () => {
  const route = routes.slice(routes.indexOf('app.get("/api/tickets/assigned-summary"'),routes.indexOf('app.get("/api/tickets/workspace"'));
  assert.match(route,/ticketStage: true/);
  assert.match(route,/ticketStage: card.ticketStage/);
});
console.log(`G27 P34 Ticket authority: ${checks}/${checks} passed`);
