# Cluster TD4 R59 → R60 handoff

## Trusted source

- Canonical code: `Cluster-v0.546.0-TD4-R59-Durable-Event-Ordering-Source.zip` (folder `source/`). Parent: R58 Source Control Links ZIP. **Use this R59 ZIP for all subsequent edits.**
- `IMPLEMENTATION_ROADMAP_R59.md` is the short active roadmap. `TECH_DEBT_MASTER_ROADMAP.md` remains historical, `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` controls release acceptance. TD0–TD3 source-closed, TD4 active.
- The checkpoint did **not** change Prisma migrations, the schema, native executables or client protocol contracts.

## Actual changes

- Canonical `apps/server/src/core/domain-events.ts`: per-resource sequence barrier in `claim`, persisted address+typed assignment guard in `deliver`, causal evidence check on idempotent collision, correct distinction between canonical resource scope and event's contextual Project scope.
- `apps/server/src/domains/activity/activity-service.ts`: normalizes assignment payload to canonical resource before same-transaction event append.
- New `tools/scripts/cluster-td4-r59-event-ordering-tests.mjs`: 20 focused tests, runtime with mock DB and actual producer. `package.json` adds `techdebt:td4:r59:verify`.
- R59 source scan/regression results and implementation notes attached.

## Next work with maximum impact

1. Audit producer/consumer ownership and provider lifecycle as one **finite** source matrix, integrate non-TD2 providers into current runtime lifecycle rather than creating a duplicate manager. Be precise about disable, drain, same-key re-subscribe, midflight writes, and recovery; test failure/revocation.
2. Complete remaining canonical Search/Action target hydration (secondary Source repository UI remains intentionally unresolved).
3. Finish bounded Library tree-wide moves/archive/restore with recovery, then governed retention, legal hold and physical disposal.

## Validation and limits

R59 focused 21/21, selected 27 inherited /27; no authored TS/CSS parse failures; generated Prisma client absent in lean archive. **Unverified:** Node 24 full build, live multi-process PostgreSQL ordering and timing, multi-user ACL, actual native Windows/Qt activation and process shutdown. Keep separate release certification; source regression is not production evidence.
