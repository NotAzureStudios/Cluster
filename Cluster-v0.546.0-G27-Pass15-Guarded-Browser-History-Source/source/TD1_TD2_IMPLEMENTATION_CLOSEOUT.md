# TD1 / TD2 Implementation Closeout | Cluster v0.546.0

**Date:** 2026-10-13. **Base:** TD3 Pass 9 source (already includes TD4 Pass 1). **Release certification:** moved to `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`, not blocking continued implementation.

## Why these phases remained open

TD1 had been source-complete since the writer/CAS and Calendar inheritance closeout, but milestone text still required actual PostgreSQL, Windows, and native testing. TD2's source runtime and durable ownership were implemented through 23 passes, but the same acceptance gates were conflated with remaining feature work. This checkpoint separates them as requested instead of repeatedly assigning them to new implementation passes.

## Core implementation contract retained

**TD1:** six typed Studio Tool Config editors, safe data-truth write preconditions, Studio impacts, provenance, null/absent-safe reset, Calendar Studio→Project→User view defaults/Project lock, server configuration publication recovery, Account two-field optimistic CAS, and distributed settings invalidation.

**TD2:** six Studio-configurable tool availability flags and route deny, owner-aware timer and subscription lifecycle, Calendar/Library durable job ownership, Ticket and cross-tool automation source/action checks, contextual job gating, authoritative queue execution checks, transactional workspace claim limits, lease fencing, retry/cancellation reconciliation, media-worker safe draining and diagnostics. Shared background services do not inherit arbitrary Tool disable flags.

## Source defects repaired in this checkpoint

1. Studio automation rule configuration now requires an explicit original `expectedRevision` for every PUT and service writer; missing versions cannot be silently replaced by the current revision. A simultaneous initial insert returns 409 revision conflict instead of leaking a raw unique-constraint error.
2. The Ticket activation endpoint checks `tickets` Tool permission/availability before the Card access check; the direct service entrypoint also defers without even loading the Card if disabled.
3. Direct Studio automation event intake rejects disabled-tool-origin events before recording a receipt; unrelated Build/Project events continue normally. A Studio automation job rechecks authoritative owner availability at its final action boundary, after the durable worker's earlier preflight, and treats a late policy disable as deferred work rather than a failed automation run. Executed side effects remain irreversible, deliberately.
4. Added 15 focused executable source tests for the above race paths and continued inherited regression coverage.

## Defined implementation exit

**TD1 core scope: implementation closed. TD2 core scope: implementation closed.** This is a source implementation statement, not a claim of compiled or running production behavior. Adding new Tool adapters, optional providers, richer Settings fields or global module architecture belongs to the later feature/extension phases when actually requested. A newly discovered concrete bug is still a bug and should be repaired in its owning subsystem without reopening entire historical phases.

**Excluded by design:** inherit-anything global Settings registry (unsafe for authorization and secrets), device roaming settings without consumer, global stop-the-world cancellation, rolling back a previously committed external side effect, arbitrary third-party executable plugin support. No legacy shims added, and no database migration or native binary changed.
