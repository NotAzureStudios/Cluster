import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { boundedRatio, visualRankWidth } from '../../packages/renderer/src/components/cluster-visual-metrics-model.ts';

// Mathematical invariants: unknown denominators do not become fabricated 100% completion.
const numeric = [
  [boundedRatio(25,100),.25],
  [boundedRatio(200,100),1],
  [boundedRatio(-20,100),0],
  [boundedRatio(0,0),null],
  [boundedRatio(Number.NaN,100),null],
  [visualRankWidth(30,60),50],
  [visualRankWidth(200,100),100],
  [visualRankWidth(-4,100),0],
  [visualRankWidth(1,0),0],
];
for (const [actual,expected] of numeric) assert.equal(actual,expected);
let assertions=numeric.length;
const source=(path)=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
function requireText(path, needles){
  const text=source(path);
  for(const needle of needles){ assert.ok(text.includes(needle),`${path}: missing ${needle}`); assertions++; }
  return text;
}
const prefix='packages/renderer/src/';
requireText(prefix+'features/admin/OperationsSystemsPanel.tsx', [
  'ClusterVisualComposition label="Connected clients"',
  'clientPosture.total != null && clientPosture.active != null && clientPosture.stale != null',
  'ClusterVisualMeter label="Media workers online"',
  '<summary>System counts & recovery evidence</summary>',
  'ClusterVisualComposition label="Observed API tools"',
  'apiTools.counts["no-observations"] + apiTools.counts["insufficient-data"]',
  '<summary>Measurement scope & limitations</summary>',
]);
requireText(prefix+'features/admin/OperationsIncidentsPanel.tsx', [
  'ClusterVisualComposition label="Open incident severity"',
  'ClusterVisualComposition label="Operational checks"',
  'health?.performanceBudgets?.failures',
  '<summary>Exact incident & diagnostic counts</summary>',
]);
requireText(prefix+'features/admin/BackgroundJobsPanel.tsx', [
  'ClusterVisualComposition label="Retained job states"',
  'value: counts.failed + counts.deadLetter',
  'ClusterVisualMeter label="Worker slots used"',
  '<summary>Exact queue counts</summary>',
  '["Failed", counts.failed]',
]);
requireText(prefix+'features/inventory/VaultManager.tsx', [
  'ClusterVisualComposition label={cursor ? "Loaded credentials · more available"',
  'record) => secretState(record) === "Revoked"',
  'reviewsLoaded && rotationReviews.some',
  'conceal();',
]);
requireText(prefix+'features/people/PeoplePages.tsx', [
  'Working hours configured · loaded people',
  'ClusterVisualMeter label="Allocated working hours"',
  'Largest teams · memberships',
  'peopleContext.teams.slice().sort',
]);
requireText(prefix+'features/admin/ProductionIntegrationAdminPages.tsx', [
  'deliverySummary && <ClusterVisualComposition label="Discord delivery outcomes"',
  'deliverySummary.deliveries.failed',
  '<summary>Exact delivery counts</summary>',
  'recentFailures',
]);
requireText(prefix+'features/notifications/NotificationInboxPage.tsx', [
  'ClusterVisualComposition label="Loaded inbox priorities" total={active.length}',
  'item.priority !== "critical" && item.priority !== "high"',
  '<summary>Quick filters</summary>',
  'filter === "unread"',
]);
requireText(prefix+'features/work/MyWorkPage.tsx', [
  'relationshipBlockers ? `${relationshipBlockers} blockers`',
  'dueTodayCards.length > 0',
  'myProjects.some((project) => getProjectHealth(project).tone !== "good")',
]);
requireText(prefix+'components/cluster-visual-metrics.css', [
  '.cluster-visual-summary-grid',
  '@media (max-width:640px)',
  ':root[data-density="dense"] .cluster-visual-summary-grid',
]);
requireText(prefix+'features/inventory/inventory-workspace.css', [
  '.cluster-vault-summary { grid-template-columns:minmax(0,1fr) auto auto;',
  '@media (max-width:650px)',
]);
// This pass may not introduce another visualization-driven server read loop.
for(const file of ['features/admin/OperationsSystemsPanel.tsx','features/admin/BackgroundJobsPanel.tsx','features/inventory/VaultManager.tsx']){
  const text=source(prefix+file);
  assert.ok(!text.includes('setInterval(() => drawChart'),`${file}: unexpected graph polling`);assertions++;
}
console.log(`RC40 cross-workspace visual checks passed: ${assertions} checks`);
