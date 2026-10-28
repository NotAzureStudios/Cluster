/** Regression checks for compilation failures reported by the first real Windows
 * Batch I installation. Full semantic compilation still runs in the installer. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const src=(rel)=>fs.readFileSync(path.join(root,'apps/server/src',rel),'utf8');
const checks=[
 ['settings satisfy generic consumer contract',()=>/type SettingPayload = Record<string, unknown> & PacketsSettingsPayload/.test(src('app/server-composition-types.ts'))],
 ['wakeup publisher has void completion contract',()=>/wakePublisher: async \(\) => \{ await coordinationBus\.publish/.test(src('app/cluster-server.ts'))],
 ['secondary event wakeup has void completion',()=>/publish\("domain-events\.wake"[^\n]+\.then\(\(\) => \{\}\)/.test(src('app/cluster-server.ts'))],
 ['context import has independent validated metadata',()=>!src('app/server-routes-context-packs.ts').includes('payload.name ||')&&!src('app/server-routes-context-packs.ts').includes('payload.description ||')],
 ['setup Prisma callbacks do not implicitly infer any',()=>!/\$transaction\(async \(tx\) =>/.test(src('app/server-routes-setup.ts'))],
 ['storage domain list stays typed',()=>/const domains: ClusterStorageDomain\[\]/.test(src('core/data-layout.ts'))],
 ['backup cancellation error imported',()=>/import \{ throwIfAborted, OperationCancelledError \}/.test(src('core/database-backup.ts'))],
 ['inactive permissions include explanation evidence',()=>/account is inactive\.", outcome: "none", reasons: \[reason\], evidence: \[\]/.test(src('domains/access/authorization.ts'))],
 ['project create fails with HTTP validation errors',()=>!src('domains/projects/project-routes.ts').slice(src('domains/projects/project-routes.ts').indexOf('app.post("/api/projects"'),src('domains/projects/project-routes.ts').indexOf('app.post("/api/projects"')+6500).includes('return reply.code')],
 ['Discord configuration reads committed values',()=>!src('domains/integrations/integration-routes.ts').includes('nextSettings.')&&src('domains/integrations/integration-routes.ts').includes('input.readSettings(true)')],
 ['network rollout accepts validated journal ID',()=>/id: string = randomUUID\(\)/.test(src('core/server-network-deployment.ts'))],
 ['search ranking handles missing cache candidate safely',()=>/const candidates = rankedCandidates \?\? \[\]/.test(src('domains/search/search-service.ts'))],
 ['library bulk selections preserve revision and lifecycle metadata',()=>/collectLibraryMatchingSelection<LibraryMatchingItem & LibraryLifecycleCandidate>/.test(src('domains/library/library-routes.ts'))&&/collectLibraryMatchingSelection<LibraryMatchingItem & LibraryLifecycleCandidate>/.test(src('domains/library/library-bulk-collection-selection.ts'))],
 ['recipient Packet acknowledgment records have keyed types',()=>/Map<string, \{manifestSha256: string;/.test(src('domains/library/packet-routes.ts'))],
 ['PDF conversion retains safety flags',()=>/isEvalSupported: false, enableXfa: false/.test(src('domains/library/packet-file-pdf-derivative.ts'))],
 ['Calendar recurrence and Scheduler optional exclusion are guarded',()=>/!result\.valid \|\| !result\.occurrences/.test(src('domains/planning/calendar-series-horizon.ts'))&&/input\.excludeOccurrence\?\.occurrenceStartsAt/.test(src('domains/time/scheduler-calendar-availability.ts'))],
 ['no implicit Prisma transaction parameter in media routes',()=>!/\$transaction\(async \(tx\) =>/.test(src('domains/media/review-routes.ts'))],
 ['live Search project bindings have typed map',()=>/new Map<string, any>\(scopeRows/.test(src('domains/search/search-live-admission.ts'))],
];
let ok=0;
for (const [label,test] of checks){const passed=test();console.log(`${passed?'PASS':'FAIL'} ${label}`);if(!passed)process.exitCode=1;else ok++}
console.log(`${ok}/${checks.length} build-blocker regression checks passed`);
