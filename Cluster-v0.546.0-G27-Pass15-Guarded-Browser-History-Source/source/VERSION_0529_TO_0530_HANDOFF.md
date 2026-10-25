# Cluster v0.529 → v0.530 handoff

## Source authority
Use `Cluster-v0.530.zip` as baseline. Previous ZIP and patch are for comparison only. No Prisma migration or native binary modifications.

## Changed implementation
- `packages/renderer/src/features/boards/board-bulk-runner.ts` and `BoardWorkspacePage.tsx`: cancellation, exact outcomes, retry/Undo history preservation.
- `apps/server/src/domains/library/library-bulk-tags.ts` + `library-routes.ts`: guarded tag removal.
- `apps/server/src/domains/library/library-9e2-routes.ts`: atomic revision-checked manual collection batch add/remove.
- `packages/renderer/src/features/library/LibraryWorkspacePage.tsx` / `library-bulk-impact.ts`: Library bulk controls and collection actions.
- `packages/renderer/src/features/admin/AdminApprovalCenter.tsx` / `admin-approval-queue.ts` / `admin-workflows.css`: approval triage/navigation.
- `tools/scripts/cluster-0530-work-library-assertions.mjs`: focused regression checks.

## Required invariants
- Cancellation stops unstarted mutations only; never claim an already submitted request rolled back.
- Preserve per-item authorization and version CAS for Library writes; nested/Personnel Records/managed-folder rules from v0.529 remain enforced.
- Collections only store references and may never grant underlying source access. Revision-conflicted or inaccessible additions must fail as a whole.
- Approval decisions remain single-use server-owned state; queue navigation is visual only, not automatic approvals.
- Preserve the native updater's no-installer/no-execution boundary.

## Remaining priority
Implement missing user-facing Work cross-tool command history and collaboration gaps, advanced Library selections/relationships, Admin lifecycle UX and stable Desktop destination mappings. Certification remains deferred by current instruction, but do not label source checks as runtime proof.
