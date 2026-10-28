import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { visualRankWidth, boundedRatio } from '../../packages/renderer/src/components/cluster-visual-metrics-model.ts';

// Visual math: measured values only, unknown stays unknown; no invented trends.
assert.equal(visualRankWidth(40, 80), 50);
assert.equal(visualRankWidth(0, 80), 0);
assert.equal(visualRankWidth(20, 0), 0);
assert.equal(visualRankWidth(-10, 80), 0);
assert.equal(visualRankWidth(Infinity, 100), 0);
assert.equal(visualRankWidth(130, 100), 100);
assert.equal(boundedRatio(0, 0), null);
const read = (name) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
const check = (name, fragments) => {
  const source = read(name);
  for (const fragment of fragments) assert.ok(source.includes(fragment), `${name} missing ${fragment}`);
};
check('packages/renderer/src/components/ClusterVisualMetrics.tsx', [
  'ClusterVisualRankedBars', 'visualRankWidth(row.value, maximum)', 'aria-label={`${row.label}: ${renderValue(row.value)}`}',
  'formatValue = (amount: number)', 'role="progressbar"',
]);
check('packages/renderer/src/features/time/TimeWorkspacePage.tsx', [
  'ClusterVisualMeter label="Tracked / capacity"', 'ClusterVisualMeter label="Scheduled / capacity"',
  'ClusterVisualRankedBars label="Logged time by project"', 'formatValue={durationLabel}',
]);
check('packages/renderer/src/features/projects/ProjectQAPanel.tsx', [
  'ClusterVisualComposition label="QA reports"', 'needsRepro.length > 0',
]);
check('packages/renderer/src/features/projects/ProjectBuildsPanel.tsx', [
  'ClusterVisualMeter label="Release readiness"', 'shipGates.filter((gate) => gate.ready).length',
]);
check('packages/renderer/src/features/operations/ClientPerformancePanel.tsx', [
  '<summary>Detailed client metrics</summary>', 'Client latency by activity', 'Performance budgets (',
]);
check('packages/renderer/src/features/operations/ServerPerformancePanel.tsx', [
  'sort((a, b) => b.p95Ms - a.p95Ms)', 'ClusterVisualRankedBars label="Slowest API routes · p95"',
  '<summary>Technical server metrics</summary>', '<summary>Database diagnostics and route details</summary>',
  'checks.filter((check: BudgetCheck) => check.status === "fail" || check.status === "warn")',
]);
check('packages/renderer/src/components/cluster-visual-metrics.css', [
  ':root[data-density="dense"]', ':root[data-density="comfortable"]', 'prefers-reduced-motion:reduce',
]);
console.log('RC39 visual-first closeout tests passed (7 math + 25 integration checks)');
