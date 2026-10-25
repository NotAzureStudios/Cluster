# Cluster v0.506 | Shared engine and access-boundary convergence

**Checkpoint:** Connected development source only. This is not a Windows/native build or a certified PostgreSQL/WebAuthn release.

## Connected implementation

### Security: idempotency vs. sensitive exports

- The global mutation-receipt engine does **not** reserve or replay receipts for Context Pack sensitive export, sensitive snapshot creation, or protected apply routes. Single-use step-up must be evaluated for each request.
- As defense in depth, any route with an outgoing `Cache-Control: no-store` response is not persisted in the mutation receipt response payload. Its receipt is marked *uncertain* rather than replayed, so a safe retry must refresh resource state.
- Ordinary idempotent mutations still store bounded, replayable responses.
- The Context Pack list endpoint marks administrative metadata `no-store`.

### Resource Graph: project-scope and access correctness

- Reject a query whose explicit `projectId` contradicts the subject's project scope.
- Evaluate subject permission at the service boundary before returning graph nodes.
- Cache repeated resource permission decisions within a single traversal.
- Preserve deterministic pagination, independent scan limits, and a *visible edge* limit. Hidden relationships do not starve visible results from the first page.
- Graph recursion still has a strict depth cap (4), edge cap (1,000), and per-hop scan cap (3,000). No separate graph database was introduced.
- Any exhausted bounded scan reports `truncated`, which callers can surface to explain incomplete results.

### Global Search: canonical Calendar visibility

- Search applies `canAccessCalendarEvent` directly for indexed Calendar events, before generic administrator shortcuts. This consumes the same owner/participant/project visibility policy as the main Calendar and other projections.
- Search responses are `Cache-Control: private, no-store`; the service's own bounded result cache remains available.

## Test evidence

- `npm run cluster:0506:cross-engine`: **9/9** executable mocked behavior checks, including live hook invocation, receipt persistence, project scoping, forbidden subjects, ACL pagination, scan bounding, cyclic relationships and Calendar search permission handling.
- `npm run verify:source-foundation`: **PASS**, including all inherited P13 + P16C + 0.506 gates.
- TS/TSX syntax/renderer import/CSS delimiter sweep: **978 files / 2,979 imports / 107 CSS**, no diagnostics.
- Prisma: **92 migration directories**; unchanged in this pass.
- No real Windows, PostgreSQL, FFmpeg GPU, WebAuthn or multi-user certification is claimed.

## Scope and remaining priorities

1. **Do not overwrite the trusted Pass 14/15 code**. The source is still reconstructed P13 + P16C + cumulative 0.506 continuations; transplant and review all deltas against the latest authoritative source before release.
2. Verify idempotency and single-use verification interplay against an actual Fastify server/session + PostgreSQL; exercise both authorized and unauthorized replay attempts.
3. Verify graph queries against real Prisma indexes with large relationship sets and multiple ACL combinations; measure query count and latency.
4. Verify Calendar visibility revocation/search index invalidation across multiple users and tabs.
5. Finish real bootstrap/recovery, managed Windows host, Qt parity and GPU-driver certification.
6. Move into the **0.507 Company/Resource Graph, permission and shared-system program** once baseline integration is resolved, keeping the rest of the complete roadmap visible.

**Naming:** keep the human-facing version `0.506`; don't revive RC/WIP/Pass artifact names.
