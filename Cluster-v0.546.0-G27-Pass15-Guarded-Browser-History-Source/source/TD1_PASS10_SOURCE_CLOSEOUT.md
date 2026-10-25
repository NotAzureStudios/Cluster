# TD1 Pass 10: Source closeout candidate (0.546.0)

Parent: `Cluster-v0.546.0-TD2-Pass9-Claim-Lease-Fencing-Source.zip`.

## Completed in this pass

1. **Long-lived Account Settings revision safety.** The authenticated `GET /api/me/preferences` returns an opaque SHA-256 fingerprint of the fresh database-stored preferences and personal accent, never a session-cached baseline. The full Account Settings editor submits that original read fingerprint with its PATCH.
2. **Stale read rejection.** The preferences route returns `409 USER_PREFERENCES_CONFLICT` if another tab/process changed preferences after the editor loaded them. It still uses the existing database `updateMany` CAS to reject races between fresh read and commit.
3. **Safe re-save.** Successful PATCH returns the newly committed fingerprint; the Account Settings editor advances its baseline only after server-acknowledged success, not when a mutation is merely queued offline. Unsuccessful saves retain the draft and do not advance the baseline.
4. **Narrow clients preserved.** Small partial PATCH clients (Desktop Library mount, Inbox, etc.) may omit the fingerprint. They merge only their supplied fields using the existing database CAS. The whole Account Settings editor must provide its original fingerprint.
5. **Writer guardrails.** A source inventory test locks down reviewed Studio Settings writer locations and checks CAS/precondition requirements for Studio Settings, Tool Config, People profile field definitions, Settings imports, and server configuration.

## TD1 scoped source contract already present from earlier passes

- Tool Config typed field definitions, defaults and constraints for six configurable tools.
- Database-truth per-field write preconditions, conflict response and draft retention.
- Studio-owned fields labeled and impact-confirmed before Tool Config mutation.
- Stored vs default provenance and atomic delete-to-reset semantics (including absent vs explicit null).
- Value-free cross-process Settings hints plus database reread and polling fallback.
- Allowlisted Calendar default-view scope: Studio -> Project -> User, Project lock and reset with revision checking.
- Security/permissions/tool enablement remain outside child scopes; **do not** inherit arbitrary Tool Config fields.

## Accepted scope / conscious exclusions

- No blanket generic inheritance engine for every setting; security and runtime flags must stay at their existing authority level. More fields must be enrolled only with defined consumer and authorization tests.
- Device-local settings stay in the native/desktop client preferences until a specific need for roaming device-wide setting inheritance is demonstrated. Do not invent a second settings database to claim completeness.
- This closes the source-level writer safety issue found in long-lived Account Settings; it **does not** certify PostgreSQL migrations or native runtime.

## Release certification still blocked

The current Linux workspace only exposes Node 22 and lacks a running PostgreSQL server, Node 24 target runtime, installed workspace dependencies/generated Prisma client, and Windows/Qt environment. Therefore the following must be executed on the target machine before declaring TD1 complete:

1. Install dependencies and generated Prisma client with Node 24.20+; run full `npm run build`, `npm run db:validate`.
2. Deploy the two TD1 Project Tool Settings migrations to a disposable PostgreSQL 17/18 database. Confirm default unlock, Project cascade, revision CAS conflicts and reset behavior, concurrent Project admins, permission denials.
3. Run two independent server processes sharing PostgreSQL. Change Studio Tool Config in one; confirm effective values and disabled-tool state propagate to the other without leaking values in coordination messages.
4. Open Account Settings in two real clients, change a preference in client B, save client A. Verify 409 with draft intact and successful resolution after refreshing; also test queued/offline save replay.
5. Validate Server Configuration DB/disk journal crash recovery on NTFS/Windows by forced restarts at each publication stage. Confirm no partial boot settings and no startup loop.
6. Verify UI inherited/default/locked Calendar behavior across Studio, Projects, Users, access revocation and Windows Desktop. Measure Settings requests and cache propagation.

**Status:** TD1 source-contract closeout candidate, **not release-certified or formally closed**. TD2 distributed worker/owner closeout remains independent and unfinished.
