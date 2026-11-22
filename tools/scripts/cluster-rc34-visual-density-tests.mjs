import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { boundedRatio, visualBarHeight } from '../../packages/renderer/src/components/cluster-visual-metrics-model.ts';

assert.equal(boundedRatio(3, 10), .3);
assert.equal(boundedRatio(-4, 10), 0);
assert.equal(boundedRatio(12, 10), 1);
assert.equal(boundedRatio(0, 0), null);
assert.equal(boundedRatio(3, NaN), null);
assert.equal(visualBarHeight(0, 10), 0);
assert.equal(visualBarHeight(10, 10), 100);
assert.equal(visualBarHeight(30, 10), 100);
assert.equal(visualBarHeight(3, 10), 30);
const check = (file, required, forbidden = []) => {
  const content = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  for (const fragment of required) assert.ok(content.includes(fragment), `${file} lacks ${fragment}`);
  for (const fragment of forbidden) assert.ok(!content.includes(fragment), `${file} still has ${fragment}`);
};
check('packages/renderer/src/features/projects/ProjectOverviewDashboard.tsx', ['<ClusterMiniRing label={item.label}'], ['<div><strong>{progress}%</strong>']);
check('packages/renderer/src/features/projects/ProjectPortfolioItem.tsx', ['<ClusterMiniRing label="Ready"'], ['<small>{completeness}% ready</small>']);
check('packages/renderer/src/features/timeline/TimelineWorkspacePage.tsx', ['className="panel tl-map" aria-label="Roadmap"'], ['label: "Cadence"']);
check('packages/renderer/src/features/settings/StudioInventoryVaultPanel.tsx', ['ClusterVisualMeter label="Available"','ClusterVisualComposition label="Stock"']);
check('packages/renderer/src/features/people/PeoplePages.tsx', ['ClusterVisualComposition label="Capacity configured"','ClusterVisualComposition label="Availability"','ClusterVisualMeter label="Allocated"']);
check('packages/renderer/src/features/home-widgets/BuiltInHomeWidget.tsx', ['ClusterVisualComposition label="Health"','ClusterVisualComposition label="Builds"','ClusterVisualComposition label="Release health"','ClusterVisualMeter label="Capacity set"']);
check('packages/renderer/src/components/ClusterVisualMetrics.tsx', ['role="progressbar"','role="img"','aria-label','visualBarHeight']);
console.log('RC34 visual metric math and UI integration checks passed');
