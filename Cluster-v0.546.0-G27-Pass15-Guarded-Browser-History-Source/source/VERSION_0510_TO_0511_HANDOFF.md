# Cluster v0.510 → v0.511 | Planning, Projects, Calendar and Library handoff

## Authoritative development baseline
- Input: `Cluster-v0.510.zip` (lean source, not reconciled with authoritative Pass 14/15 source).
- Output: `Cluster-v0.511.zip`, plus `Cluster-v0.511.patch` relative to the exact input ZIP.
- v0.510 Projects/Calendar/Library work transitioned into the 0.511 Communications/Distribution wave. The 0.510 full feature scope remains incomplete, including advanced calendar layers and the broader Library 3.0 UI.

## Implementation
1. Project closeout: server-side lifecycle transition table; CAS revisions on metadata and action routes; Serializable status action transaction with freshness/readiness recheck; manager-only sanitized partner links; advisory-locked first-read record creation; explicitly restricted manual checks; no-store responses. Database counts replace full Card/Library scans.
2. Calendar: explicit ISO timezone-bearing event dates, time-zone validation, bounded range windows, overlap-correct multi-day range queries, DST-safe scheduler recurrence (earlier occurrence for fall ambiguity, forward gap for spring nonexistent wall time).
3. Library: exact destruction preview counts and truncation flags; deletion requires observed preview revision and transactional recheck of hold, retention, children, backlinks and title; only unlink blobs unreferenced by surviving Library items/versions.
4. Source-only regression test added at `tools/scripts/cluster-0510-planning-hardening-assertions.mjs`.

## Residual risks and certification gates
- Live PostgreSQL Serializable conflict retry policy and disk unlink/DB commit crash reconciliation require runtime tests. Other storage actors may need coordination on blob paths; physical deletion remains non-transactional, with orphan clean-up on failure.
- No full generated Prisma-client build or real multi-user authorization runtime occurred. Calendar recurrence must be tested against user locale and DST in full Client/Desktop.
- Project closeout audit events are logged after the transaction; outbox-backed exactly-once evidence is a future improvement.
- This source descends from Pass 13 + P16C plus staged work. Authoritative Pass 14/15 merge remains a required conflict review before release.
- Do not call this a production-certified Windows executable. No native binaries were rebuilt.

## Next development pass
Implement 0.511 Communications/Packages/Entitlements/Integrations until the next `0.512.0` version transition; retain final 0.512 certification as a separate gate.
