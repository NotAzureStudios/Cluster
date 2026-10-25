# TD1 Pass 11: Account CAS correctness and real PostgreSQL certification gate

**Parent source checkpoint:** `Cluster-v0.546.0-TD1-Pass10-Account-Writer-Closeout-Source.zip`.

## Source-level closeout

- Fixed a real time-of-check/time-of-use race in Account Settings. Its read-version fingerprint covers both `User.preferences` and `User.personalAccentColor`, but the prior Prisma `updateMany` compared only the preferences column. Concurrent accent-only writes occurring after the fresh read could be overwritten. The database CAS now includes **both** columns.
- Expanded the executable Account Settings regression suite to test two versions of the accent-only race (long-lived full editor and narrow accent PATCH). A late accent change must return HTTP 409, preserve the newer accent and leave unrelated preferences untouched.
- Preserved prior Settings ownership, per-field Tool Config CAS, Studio confirmation, override reset, provenance, Calendar Project/User default inheritance and lock, and value-free distributed invalidation.
- Added `npm run techdebt:td1:postgres`, an **opt-in**, destructive-operation-guarded, isolated-schema **real PostgreSQL integration gate**. It runs the exact two TD1 migrations against a minimal Project fixture and exercises two independent SQL clients, override CAS, lock/reset, Project cascade, and the corrected two-column preferences CAS. It never modifies the `public` schema. A missing database or dependency reports **BLOCKED**, not PASS.

## What the new integration gate proves, and does not

When run on disposable PostgreSQL 17/18 with `pg` installed, it proves the migration SQL works against a minimal Project fixture and checks isolated SQL-level concurrent behavior. It does **not** prove the entire Prisma migration history on a real Cluster database, actual Fastify authorization, the two-process coordination bus, UI, or Windows/NTFS publication recovery. Those require the separate release tests below.

## Required target-environment certification (not executed here)

In a clean test workspace on the real Windows host (not production):

1. Use Node 24.20+, restore pinned dependencies, generate Prisma client, run `npm run db:validate` and `npm run build`. This lean source archive omits `node_modules`, generated Prisma and dependency lockfile, so a reproducible install must come from the canonical development repo/build process.
2. Provision a disposable PostgreSQL 17/18 DB, with a role permitted to create/drop a dedicated schema. In **PowerShell**:

   ```powershell
   $env:TD1_CERT_DATABASE_URL = 'postgresql://test_user:test_password@127.0.0.1:5432/cluster_td1_disposable'
   $env:TD1_CERT_DISPOSABLE = 'I_UNDERSTAND'
   npm run techdebt:td1:postgres
   Remove-Item Env:TD1_CERT_DATABASE_URL, Env:TD1_CERT_DISPOSABLE
   ```

   Replace the placeholder with a real *disposable* database. Never paste credentials into build logs or a shared handoff.
3. Separately deploy **all real Prisma migrations** to a fresh disposable Cluster DB, exercise Account/Studio/Tool Config settings from two authenticated clients, and verify Project Calendar locks, resets, delete cascades and denied Project access.
4. Run two independent server processes with the same PostgreSQL configuration. Verify Studio Settings propagation to both, 409 stale edits, read-after-write consistency, and that coordination messages contain no values/secrets.
5. Fault-inject server configuration publication on NTFS/Windows, restart between journal/file/DB stages, and verify recovery plus no startup loop.
6. Validate browser and Qt-owned Windows controls, accessibility, settings provenance, disabled-tool effect and user/calendar preferences while offline and after reconnect.

## Result in current execution environment

- Existing TD0–TD2, Studio Settings, writer guard, Registry and crash-recovery source commands: **26/26 passed**.
- Expanded Account read-version checks: **10/10 passed** (part of 26 commands).
- PostgreSQL gate: source syntax verified; actual DB run **BLOCKED** (no PostgreSQL service/client dependencies in this environment).
- Node runtime here is **22.16.0**, not Cluster's required Node 24.20+. Full dependency-backed compilation and Windows recovery **not run**.

**Decision:** TD1 functional source contract is a closeout candidate. Release certification is still OPEN. Do not label TD1 production-certified or start depending on an unverified migration as if it were a green deployment.
