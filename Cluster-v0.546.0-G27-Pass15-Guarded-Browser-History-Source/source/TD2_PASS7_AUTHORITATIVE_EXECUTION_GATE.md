# Cluster v0.546.0 — TD2 Pass 7: Authoritative Owned-Job Execution Gate

**Parent:** `Cluster-v0.546.0-TD1-Pass9-Project-Calendar-Parent-Lock-Source.zip`

## Change

- Added a configurable pre-handler async verification hook to the existing `DurableJobWorker`, after job authorization and before invoking handlers.
- Wired Calendar scan and Library transfer/derivative jobs to force-refresh Studio Settings through the **existing authoritative settings service** at the execution boundary. The canonical `STUDIO_TOOL_DURABLE_JOB_TYPES` table identifies the owner, and `TOOL_AVAILABILITY` identifies the enablement key.
- When a remote process has disabled a tool but this worker still has stale local state, its owned job is deferred in the established lease-fenced queue path. It does **not** execute or count as a failed/retried attempt.
- If Studio Settings cannot be read, owned work is conservatively deferred; errors are logged without exposing configuration values.
- Shared maintenance and notification job types are not assigned fake tool owners and do not incur an authoritative Settings read.
- A final local availability and cancellation check is retained after the async database read.
- No new service, tool, database table, Prisma migration, or changes to native binaries.

## Important limits

- The authoritative read closes the **known stale-local-cache pre-handler window**, not all distributed races: an administrator can disable a tool after the check while a handler is already executing. The existing approach deliberately lets file commits finish to avoid corruption. Fencing of in-flight side effects and live multi-process testing remain TD2 work.
- The forced read adds a database/configuration read per **newly executing, enrolled owned job**. It is not performed for general maintenance; measure its cost under load.
- Because this is a lean source archive, the Node 24 dependency-backed build, actual PostgreSQL multi-process tests and Windows runtime certification were not performed.
