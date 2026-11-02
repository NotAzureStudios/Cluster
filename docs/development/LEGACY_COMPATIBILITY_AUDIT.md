# Legacy compatibility and fossil-cleanup pass

## Scope and policy

Cluster has **no active production instances** whose data must be migrated. The working branch is `development`. Prefer deleting genuinely obsolete aliases, migration fallbacks and compatibility shims rather than preserving historical behavior indefinitely. **Do not** confuse current protocol version compatibility, supported feature variants or crash-recovery contracts with legacy scaffolding.

This initial pass removes a positively identified old Qt journal migration fallback and its now-obsolete test assertion. The exact active journal path remains unchanged, and no user files are automatically deleted by the cleanup.

## Removed

- **Qt desktop old journal fallback:** `TransferManager::legacyStoragePath()` read journals from the global Qt `AppDataLocation/transfers` directory when the modern profile-scoped transfer journal did not exist.
- **Journal import/removal branch:** `migrateLegacy` and its one-time re-save/delete handling. The current `<profileDataRoot>/transfers/transfers-<scope-hash>.json` journal remains the only authority.
- **Historical ownership assertion:** A G26 test used to demand the presence of the legacy migration branch. It now checks that the canonical journal is loaded and damaged journals remain blocked.
- **Outdated explanatory copy:** Queue admission no longer describes oversized journals as legacy imports. The protective nontruncation behavior remains because it is a **current safety guarantee**, not backward compatibility.
- **RC3-specific PostgreSQL repair:** Removed the `recoverRc3MeetingOccurrenceMigration` hook from normal database deploy/release, its one-off `migration-recovery.mjs` helper and its dedicated `cluster-rc4-migration-tests.mjs` test. This repair existed solely to heal the 63-byte index-name collision in a historical RC3 deployment, and Cluster has no production database requiring that compatibility. Fresh deploy still requires the migrations directory and runs Prisma `migrate deploy`. The actual schema and migrations are not removed.

## Audited and retained

| Candidate | Decision | Reason |
| --- | --- | --- |
| `apps/server/src/core/acceleration/redis-compatibility.ts` | Keep | Runtime Redis protocol self-test, not migration compatibility |
| `package-segment-download.ts` bounded in-memory helper | Keep | `DesktopDevicePackagesPanel.tsx` still calls it for the Package archive path; native sink flow is also live |
| Qt `ApiClient` protocol compatibility fields | Keep | Required to block clients with incompatible server API/protocol versions |
| Qt transfer journal validation, per-profile writer lock and recovery checks | Keep | Current crash safety and cross-window fencing |
| `/api/source-control/resolve-commit` | Defer | Described as a legacy deep-link resolver, but request authorization and caller/URI producer inventory are needed before deletion |
| Library root-only lifecycle mutations | Defer | Need to prove that modern hierarchy lifecycle is the only caller before deleting routes |
| Prisma migration history | Defer | Must create and test a fresh baseline and verify clean setup before squashing; do not blindly delete SQL history |
| RC-era focused regressions | Keep for now | Many are invoked from root package commands; inventory and dependency analysis before pruning |

## Validation

```sh
node tools/scripts/cluster-compatibility-fossil-tests.mjs
node tools/scripts/cluster-g26-multiwindow-transfer-ownership-tests.mjs
node --check tools/scripts/database-command.mjs
```

The regression guard asserts absence of the retired path and preservation of current canonical journal ownership and Package transport paths. This is a source contract test, **not** a successful Qt build or Windows crash-recovery test.

## Next cleanup boundaries

1. Compare the newest source archive with GitHub; the current source branch remains older than RC74 and must not accidentally resurrect removed compatibility code during import.
2. Inventory candidate obsolete API routes with **both server route registration and client callsites**. Remove matching contracts and tests together. No alias/shim should be added to preserve nonexistent clients.
3. Build an explicit fresh-install Prisma baseline on disposable PostgreSQL, then squash migrations if reproducibility and recovery checks pass.
4. Identify script files with no package-command, CI, tool-registry or internal references, and archive/remove only after replacing the useful regression coverage.
5. Do not delete active Redis/protocol checks, Qt recovery journals, platform-specific source or shared data safeguards in the name of fossil cleanup.
