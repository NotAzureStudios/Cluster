# Cluster v0.507 → v0.508 handoff

**Transition checkpoint:** `Cluster-v0.508.zip` / internal SemVer `0.508.0`.

The v0.507 Company/Resource Graph, permissions and shared action/picker wave is sufficiently developed to move into v0.508 feature work **but not exhaustively complete and not certified**. This transition is a roadmap milestone, not production release approval.

## v0.507 continuation implemented in this checkpoint

1. Canonical Access Explorer shows independent target-tool, Project and target authorization with provenance, while omitting stale personal caches (`private, no-store` and direct API fetch).
2. Project Access rule list uses **only authorized picker resource names**, with safe generic fallback for restricted targets.
3. Project Overview, Project Control and People profile menus reuse Resource Action Registry adapters (no new server-side permission system).

## Carry-forward backlog (not secretly dropped)

- Per-person Project-scoped positive permission bundle grants; do not allow grants to bypass Project/resource/Library restrictions.
- Full user-specific, privacy-preserving impact simulation (existing bounded Access Rule impact is narrower).
- Wider search/picker, action/command, references, inspector and graph integration, including very large data sets.
- Live PostgreSQL, Windows and multi-user authorization/privacy tests; version compatibility; full dependency-backed TypeScript; authoritative P14/P15 source reconciliation.

## New v0.508 work underway

People POST atomic account + workspace membership + workforce authorities. People PATCH atomic profile revision + normalized workforce + workspace-role updates. Tested with executable extracts of actual Prisma transactional closures and mock rollback. `request-policy.ts` already marks privileged POST and PATCH People mutations admin-only, enforced by `createRequestAuthorizationBoundary` before the handler.

## Next milestone cadence

Do not hand off after every minor 0.508 WIP pass. Continue feature engineering through People → Forms → Packets → Inventory/Entitlements → Vault, with source and security regression every batch, until transitioning to v0.509. Full production certification remains the later 0.512 gate.
