# TD4 R50 | People and governance provider authorization audit

## Observed defect

`/api/changes` already enforced canonical provider authorization for project, Library, delivery, Forms/Packets and Source Control. Yet four People identities and three governance identities still fell into the generic target-access path. Administrator fast-path admission could return nonexistent IDs, and a generic grant could reveal restricted Studio broadcast or another user's onboarding-assignment identifiers.

## Implemented authority

- **People:** `user` / `studioTeam` / `department` / `jobRole` lookups select identity/lifecycle only. Normal visibility requires People `view`; archived records require People `manage`; non-archived self identity remains visible to self without global People access. Privacy-erased User identities are excluded for every role. A resource-change event does not confer access to the user's private profile, Personnel Records, or contacts.
- **Announcements:** `studioAnnouncement` identity and status are checked. Ordinary viewers require `published` plus current Studio Audience eligibility; Studio Systems reviewers may receive actual draft IDs for administration.
- **Policies:** `studioPolicy` identity, active state, published-version existence, and current Studio Audience are checked. Reviewers may see an actual draft. This mirrors required-policy discovery's published-version rule.
- **Onboarding assignments:** `studioOnboardingAssignment` identity and canonical `userId`, `planVersion.status` and parent `plan.status` govern recipient admission. The owner may receive a revoked-assignment invalidation to clear stale UI, but draft/inactive plan IDs are restricted to authorized Studio Systems reviewers.
- **All seven:** Project envelope spoofing fails, nonexistent resources fail, and Prisma/Audience read failures fail closed. Per-session role/team freshness and TD2 tool-lifecycle filtering are inherited from the canonical route.

## Evidence

`tools/scripts/cluster-td4-r50-governance-feed-tests.mjs` runs 34 checks through the actual `/api/changes` route, not registration grep alone. It covers private and excluded audiences, malformed JSON, nonexistent records, archived People, privacy-erased identity, self view, revocation, status/version gates, database outages and forged Project scopes. The inherited R43–R49 provider and SSE regressions remain green.

## Explicitly not claimed

- These tests use a mocked database and authorizer. No live PostgreSQL, Node 24 production runtime, multi-user browser, installed Qt or release certification occurred.
- This does **not** grant private People profile data to the change feed. Profile field visibility remains owned by the People routes and disclosure policies.
- No new published event producer or generic event registry was introduced. Typed producer/consumer contracts and remaining resource providers remain TD4 work.
- Retention-governed physical deletion and hierarchy-wide durable Library operations remain open.
