# Cluster v0.507 | Scoped Permission Bundles + Effective Access Preview

**Continuation date:** 2026-10-08
**Baseline:** 0.507 Authorized Discovery source tree, preserved in the attached workspace after the previous archive proved incomplete/corrupt.
**Status:** Source-implemented and focused regression-tested. NOT integrated, compiled with dependencies, or production-certified.

## Delivered this pass

1. **Single policy authority preserved.** `studioPermissionBundles` is Studio Settings configuration, NOT a new ACL table. It feeds the existing `createAuthorizationService()` tool permission inheritance and `resolveClusterEffectiveState()` provenance engine. Ordinary Project-level membership, direct Access Rules, and tool caps still use their established domains.
2. **Reusable scoped bundles.** Add up to 64 stable-ID bundles with typed tool access (`none | view | edit | manage`), human name, description, revision and enable flag. Department and Studio Role definitions can assign ordered bundles; maximum 16 assignments per definition. Disabled bundles remain referenced but contribute nothing.
3. **Precise precedence.** Workspace role default → Department preset → Department bundles → Department explicit overrides → Role preset → Role bundles → Role explicit overrides → User-specific tool overrides. Owner and Admin authority retains its special protected branch. Access expiration still denies non-admin tool access.
4. **Versioned publish guard.** New bundles start revision 1; material edits must increase exactly one revision; unchanged bundles retain their revision; deletion is rejected (disable instead). Reject duplicate/invalid IDs, unsupported permissions, dangling/duplicate assignments, malformed payloads and excess counts before Studio Settings save. Existing admin + security PIN + optimistic-concurrency precondition continues to control publication.
5. **Explainability + performance.** Effective-state provenance identifies `bundle:<id>@<revision>` and its Department/Role scope. Validation results are cached by stable config-array identity to avoid revalidating on every permission check; new published settings replace the array.
6. **Admin-only dry run.** `POST /api/access/permission-preview` accepts an unsaved Studio policy draft and returns the current/proposed effective permission matrix and changed keys. It reuses the LIVE resolver, does not mutate database/Settings, returns no-store, and checks admin authorization.
7. **Actual admin UI.** Studio Settings → Roles manages bundles, overrides, enable/disable, revisions and role assignment. Department permission editor manages department bundle assignments. Studio Role editor can preview access differences including provenance. Stale async preview responses cannot overwrite newly edited drafts.
8. **Test coverage.** Two executable test gates: 28 shared-contract+source assertions, 14 real authorization-engine runtime inheritance assertions. Existing targeted tests for discovery, shared actions, picker, Company Graph, Resource Graph and Pass 16C were rerun.

## Known limitations / next milestone

- This is Studio/Department/Role **tool-permission** bundle support. Project-scoped and resource-scoped role assignments, membership policy diffing, broader permission simulation, and detailed group-effective access remain ahead. Do not present Studio bundles as Project ACL grants.
- A bundle's `revision` is a configuration revision number; the existing Studio Configuration revisions/backups provide rollback. A standalone immutable per-bundle history browser is not implemented.
- The server must undergo dependency-backed compilation (`npm install` + build), PostgreSQL/Windows tests, multiple active account checks, admin PIN and CSRF validation, and true DPI/UI testing before release.
- No Prisma migration, no new ACL database, and no Windows native binary rebuild in this pass.
- Pass 14/15 authoritative source conflict review remains unfinished; preserve this limitation through handoff.
- Existing authorized-discovery ZIP was incomplete/corrupt in this session. The supplied valid baseline was the existing extracted source checkpoint; this new ZIP is freshly assembled and verified.

## Next 0.507 wave

1. Project/Team scoped roles & membership policy: integrate with canonical ProjectMembership and AccessRule mechanics, no shadow ACL table.
2. A broader permission simulation/impact preview for proposed Project Access Rule changes, consistent with actor privacy and denial filters.
3. Company/Resource Graph pagination and resource picker discovery improvements, and expansion to additional tools.
4. Cross-tool shared action registry and selection/mutation governance; reconcile Pass 15 source before calling any integration validated.

**Lifecycle:** Backend Ready + UI Ready + source-level tests. Integrated runtime / Certified remain OPEN.
