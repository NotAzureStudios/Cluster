# G26 Pass 22 | Durable Evidence-Link Status & Idempotent Server Replay

## Why this pass exists

Pass 21 correctly finalized a Project file before submitting a separate `evidence_for` relationship, but the Desktop transfer projection still displayed only byte status. A lost relationship reply could also cause a repeat POST which upserted the original relationship, changed `createdById`, and logged another creation activity.

## Implemented source changes

- Journal loading independently validates the typed relation intent, canonical destination Project ID, saved file ID, project, checksum and length, and completed relationship identity. A purported complete evidence transfer without matching saved-link proof invalidates the journal and holds it read-only instead of reporting success.
- Native transfer projection exposes `stage`, `fileSaved`, `evidenceStatus`, and bounded `evidenceTargetKind` without exposing local file paths or full journal internals. `committing` distinguishes Project-file finalization from relationship creation.
- Transfer Center and Sync Center label those stages distinctly. A link failure with a committed Project file says **file saved, evidence linking failed**; its action is **Retry link**, not a misleading re-upload. The resumable path retains the finalization receipt and never asks for source bytes again.
- Canceling linking after file finalization preserves the terminal record visibly until the operator dismisses the local history entry; the underlying Project file is not deleted.
- The native transfer event now includes the writer posture and current transfer list. Transfer Center and Sync Center consume this push directly, removing redundant bridge reads for every progress update, and renderer discards stale-profile native events. Initial and interval safety reconciliation still exist where previously defined.
- Workflow-link POST now attempts a single database `create`. On a unique-key collision it reads and returns the existing identity, after the current authorization checks, instead of updating creator identity or generating extra activity. Library backlinks still reconcile idempotently after a replay. The existing PATCH endpoint remains the way to modify a relationship.

## Validation and limits

- New regression script executes the actual extracted TypeScript POST handler against controlled concurrent Prisma promises, unique collisions, authorization gating, and injected failures, and checks connected Desktop source contracts. This is not a live PostgreSQL test.
- Inherited G26 Pass 14–21 scripts and portable native C++ policy checks continue to run. TypeScript/TSX syntax, relative renderer imports, and CSS structural scan remain in the source pipeline.
- Qt is not present in the test environment, so linked Qt executable behavior and Windows OS file identity, atomic journal persistence, native events, and real user permissions are not certified.
- The event is still scoped to the active native profile and uses the current source protocol; no backward compatibility shims are introduced.
- Destructive storage cleanup, unverified package/MSI success inference, and remote provisioning remain disabled or outside this pass.

## Next substantive G26 targets

1. Native transfer browser/mobile parity, explicit recoverability UI, origin revocation and two-window runtime acceptance.
2. Package/installer supervised update/repair/uninstall and independently attested installed-state recovery.
3. Cross-workflow integration, especially Library/file relationship references, derived delivery and retention boundaries.

Do not call G26-08/09 source-closed based on the focused checks.
