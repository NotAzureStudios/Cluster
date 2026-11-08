// RC21: focused tests for request fairness, shared 429 cooldown, and Library density.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTrafficLane, noteReadRateLimit, rateLimitCooldownRemaining, retryAfterMilliseconds, readRateLimitCooldown, resetReadRateLimitCooldowns, readRateLimitGeneration } from '../../packages/api-client/src/read-rate-limit.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
let checks = 0;
const check = f => { f(); checks++; };
check(() => assert.equal(readTrafficLane('/api/library/workspace?parent=root','GET'), 'api-library'));
check(() => assert.equal(readTrafficLane('/api/admin/inventory/assets?limit=30','GET'), 'api-inventory'));
check(() => assert.equal(readTrafficLane('/api/notifications/summary','GET'), 'api-live'));
check(() => assert.equal(readTrafficLane('/api/meta/compatibility','GET'), 'api-compatibility'));
check(() => assert.equal(readTrafficLane('/api/library/workspace','POST'), null));
check(() => assert.equal(retryAfterMilliseconds('6', 1000), 6000));
check(() => assert.equal(retryAfterMilliseconds('150', 1000), 60000));
check(() => assert.equal(retryAfterMilliseconds('nonsense', 1000), 0));
check(() => assert.equal(retryAfterMilliseconds('Thu, 01 Jan 1970 00:00:09 GMT', 1000), 8000));
resetReadRateLimitCooldowns();
noteReadRateLimit('api-library','7',10_000);
check(() => assert.equal(rateLimitCooldownRemaining('api-library',11_000),6000));
check(() => assert.equal(rateLimitCooldownRemaining('api-inventory',11_000),0));
check(() => assert.equal(rateLimitCooldownRemaining('api-library',18_000),0));
resetReadRateLimitCooldowns();
// Exercise a genuinely pending wait, not an already-expired lane.
noteReadRateLimit('api-live', '30');
const abort = new AbortController();
const promise = readRateLimitCooldown('api-live', abort.signal);
abort.abort();
await assert.rejects(promise, { name: 'AbortError' });
resetReadRateLimitCooldowns();
check(() => assert.equal(rateLimitCooldownRemaining('api-live'), 0));

// Reset must wake both waiting requests before their original 30-second timer.
const generation = readRateLimitGeneration();
noteReadRateLimit('api-library', '30');
const parked = [readRateLimitCooldown('api-library'), readRateLimitCooldown('api-library')];
resetReadRateLimitCooldowns();
let watchdog;
try {
  await Promise.race([
    Promise.all(parked),
    new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('Reset left old reads waiting')), 500); }),
  ]);
} finally { clearTimeout(watchdog); }
check(() => assert.equal(readRateLimitGeneration(), generation + 1));
check(() => assert.equal(rateLimitCooldownRemaining('api-library'), 0));
const server = read('apps/server/src/core/request-workload.ts');
check(() => assert.match(server, /bucketName: "api-library"/));
check(() => assert.match(server, /bucketName: "api-inventory"/));
check(() => assert.match(read('apps/server/src/app/server-request-security-services.ts'), /X-Cluster-Rate-Limit-Bucket/));
check(() => assert.match(read('apps/server/src/app/server-request-infrastructure.ts'), /configuredLimit: apiRateLimitMax/));
const client = read('packages/api-client/src/index.ts');
check(() => assert.match(client, /noteReadRateLimit\(trafficLane, response\.headers\.get\("retry-after"\)\)/));
check(() => assert.match(client, /await readRateLimitCooldown\(trafficLane, init\.signal\)/));
check(() => assert.match(client, /Math\.min\(60_000, Math\.max\(0, retryAfter \* 1_000\)\)/));
check(() => assert.match(read('packages/renderer/src/core/api/transport.ts'), /API_TIMEOUT_MS \+ 65_000/));
check(() => assert.match(client, /requestCooldownGeneration === readRateLimitGeneration\\(\\)/));
const library = read('packages/renderer/src/features/library/LibraryWorkspacePage.tsx');
check(() => assert.match(library, /showSavedViews \? <div className="library-views-flyout-v22"/));
check(() => assert.doesNotMatch(library, /showFilters \|\| activeFilterCount > 0 \? <SavedViewsToolbar/));
check(() => assert.match(library, /error && !items\.length \? null/));
check(() => assert.ok(Number(JSON.parse(read('config/release-candidate.json')).sequence) >= 21));
console.log(`RC21: ${checks}/${checks} focused cooldown, 429 diagnostics, UI and rate-lane checks passed`);
