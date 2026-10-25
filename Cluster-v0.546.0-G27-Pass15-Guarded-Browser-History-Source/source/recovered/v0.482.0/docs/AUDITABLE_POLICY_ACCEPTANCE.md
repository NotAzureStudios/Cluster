# Auditable Policy Acceptance

Roadmap Step 17 of 20 is implemented in Cluster v0.378.0.

## Purpose

Cluster can require an authenticated user to acknowledge or affirmatively accept an exact, immutable published Privacy Policy, Terms of Service, or Server Operator Agreement version before the rest of the authenticated application is available. Publication and acceptance are separate actions: publishing a policy never silently creates user acceptance evidence.

This system records what Cluster observed. It does not decide whether a policy is legally enforceable, whether a particular acceptance mechanism is sufficient in a jurisdiction, or whether a user had legal authority to agree on behalf of another party.

## Operator-controlled requirement

Each draft policy version has two explicit fields:

- `acceptanceMode`: `none`, `acknowledge`, or `accept`.
- `acceptanceAudience`: `all_users` or `admins`.

Existing policy rows migrate to `acceptanceMode=none`. Upgrading to v0.378.0 therefore cannot turn an already-published policy into a mandatory gate by accident.

The requirement is immutable once the policy version is published. To change the text, mode, audience, or other published-policy state, publish a new version instead of editing history.

Only the currently effective published version of each supported policy kind can create a gate. If a newer effective version explicitly uses `none`, it supersedes an older required version rather than leaving the old gate active.

## User review boundary

When a current policy requires action, Cluster blocks normal authenticated API use with `POLICY_ACCEPTANCE_REQUIRED` and renders the dedicated policy-review screen. Login, account-setup completion, logout, public policy pages, and the acceptance endpoints remain reachable so the user can review the exact document or leave the session.

The review screen shows:

- policy kind, title, version, and effective date;
- the exact SHA-256 content hash;
- a link to the public immutable policy document;
- an explicit unchecked acknowledgement or acceptance control; and
- wording that distinguishes acknowledgement from affirmative acceptance.

Cluster does not infer consent from sign-in, continued use, a pre-checked box, publication, scrolling, or opening the policy page.

## Evidence model

`PolicyAcceptance` is an append-only application record. The normal API exposes no update or delete route. Each record binds:

- original user identity and preserved subject username;
- exact policy ID, kind, version, and content hash;
- acceptance mode and audience;
- a requirement hash covering the immutable policy/requirement tuple;
- acceptance timestamp;
- session ID and authentication method when available;
- request IP, user agent, client source, and request ID; and
- an evidence SHA-256 hash over the critical acceptance tuple.

A stable `subjectPolicyKey` prevents duplicate evidence for the same user and policy version while allowing the user foreign key to become null if an explicit future account-deletion/anonymization workflow removes the account. The historical subject key and evidence remain available for review.

Cluster recomputes the evidence hash when deciding whether stored evidence satisfies a current gate and when an administrator reviews acceptance history. Evidence that fails integrity verification is treated as incomplete and surfaces a Legal & Compliance warning.

## Session enforcement

Cluster computes a digest of the current applicable policy requirements. A session stores the last fully-satisfied digest in `Session.policyAcceptanceDigest`.

This gives the request boundary a cheap fast path while preserving fail-closed behavior:

1. if the session digest matches the current requirement digest, normal authorization continues;
2. if requirements changed, Cluster checks immutable acceptance evidence;
3. incomplete evidence returns HTTP 428 with `POLICY_ACCEPTANCE_REQUIRED`; and
4. once all current requirements are satisfied, the session digest is updated.

The current-policy cache is intentionally short-lived and is explicitly invalidated when a policy is published. A new required version therefore cannot rely on a long client cache to enforce access.

## Administration and privacy

Legal & Compliance shows the number of current required versions, pending users/requirements, acceptance history, request/session context, and evidence-integrity state. Administrative reads remain inside `/api/admin/*`, so the centralized admin authorization boundary applies.

Users can see their own acceptance history in Privacy & Data. Personal-data export schema v2 includes policy acceptance records. Generic age-based data retention deliberately excludes these records because legal evidence should not disappear through an unrelated cleanup timer; any deletion or anonymization policy needs its own explicit operator/legal workflow.

## Security properties

- Unsafe acceptance POSTs still require the normal authenticated CSRF/origin protections.
- Acceptance cannot be recorded for a stale policy content hash.
- Duplicate policy IDs in one request are rejected.
- Concurrent duplicate submissions collapse onto the unique subject/policy evidence record rather than creating duplicates.
- Mandatory acceptance runs before normal authenticated route authorization but after account setup, so a half-configured account is not treated as valid acceptance evidence.
- Admin-only requirements are evaluated from current authorization state; promotion to admin changes the requirement digest and can trigger a new gate.
- Public policy pages stay pre-auth readable so the user can inspect the document without accepting it.

## Roadmap boundary

Step 17 provides version-bound acknowledgement/acceptance evidence and enforcement. It does not provide legal advice, jurisdiction-specific clickwrap conclusions, age/guardian consent, contract-signature workflows, third-party e-signature services, or a behavioral-analytics consent system. Those concerns remain separate boundaries rather than being quietly implied by a checkbox.
