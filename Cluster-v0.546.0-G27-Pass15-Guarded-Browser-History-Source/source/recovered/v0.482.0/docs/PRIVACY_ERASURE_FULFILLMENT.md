# Privacy Request Fulfillment & Legal Holds

Cluster v0.380.0 completes Legal / Privacy / Accessibility Roadmap Step 19 of 20 by turning account-data deletion requests from a review-only queue into an explicit, auditable fulfillment workflow.

## Fulfillment state machine

A deletion request begins as `pending`. An administrator may reject it or explicitly move it to `approved` with a recorded review note. Approval does not itself erase data. An approved request exposes a server-generated erasure plan and must be separately fulfilled with recent authentication plus the typed confirmation `FULFILL PRIVACY ERASURE`.

Fulfillment is idempotent. A unique `PrivacyErasureReceipt` binds the request, subject, plan hash, aggregate result, actor, timestamp, and SHA-256 evidence hash so retries do not run a second destructive pass.

## Pseudonymization rather than referential destruction

Cluster does not delete the `User` row during Step 19 fulfillment. The live account is instead moved to `PRIVACY_ERASED`, archived, stripped of direct profile/contact/employment/identity fields, stripped of credentials and permissions, and renamed to an opaque `deleted-<user-id>` subject.

The fulfillment transaction removes active access/session material, privacy consent, first-party behavioral analytics events, obsolete authentication challenge material, pending Discord-link challenges, avatar-audit profile material, and workspace memberships. Authored project/work records, security-audit evidence, policy-acceptance evidence, privacy-request history, legal-hold history, and the erasure receipt remain attributable to the pseudonymous subject.

This is deliberate. A cascading account delete would make historical work, security evidence, and legal evidence unreliable or force unrelated records to disappear merely because the identity attached to them requested erasure.

## Privacy legal holds

`PrivacyLegalHold` provides an explicit preservation boundary. Active holds are administrator-created, require recent authentication and typed confirmation, contain a required reason plus an optional matter/authority reference, and do not auto-expire. Any active hold makes the erasure plan fail closed and blocks fulfillment with `PRIVACY_ERASURE_LEGAL_HOLD`.

Releasing a hold is a separate recently authenticated administrator action requiring a release note and typed confirmation. Creation and release are written to Cluster's security audit trail.

## Admin workflow

Legal & Compliance → Privacy & Data now exposes:

1. pending requests for approve/reject review;
2. approved requests with a previewable server-side erasure plan;
3. explicit fulfillment with destructive counts and an evidence digest;
4. active privacy legal holds and release controls; and
5. fulfilled requests with the stored fulfillment digest.

An administrator cannot fulfill erasure of the same account currently authorizing the action.

## Backup boundary

Step 19 operates on the current live Cluster database and active account state. It does not rewrite historical backup generations in place. Existing backups continue to follow Cluster's backup retention and recovery policy until those generations expire or are deliberately destroyed under an operator-approved process. Restoring an older backup can therefore restore pre-erasure data and must be followed by the operator's documented privacy/reconciliation procedure.

Cluster does not claim that this workflow alone satisfies every jurisdiction's erasure, preservation, employment-record, litigation-hold, or backup exception rules. Operators remain responsible for deciding which records must be preserved and when a hold can legally be released.

## Security properties

- all fulfillment/hold mutations are under `/api/admin/*`, central administrator authorization, CSRF/origin enforcement, and recent re-authentication;
- destructive fulfillment requires an additional exact confirmation phrase;
- approval and fulfillment are separate actions;
- active legal holds fail closed;
- self-erasure by the authorizing administrator is blocked;
- the erasure plan is hash-addressed before execution;
- fulfillment is transactional and idempotent; and
- security/policy/erasure evidence is preserved rather than hidden inside generic retention cleanup.

Roadmap Step 20 is completed in Cluster v0.381.0 by the final legal/privacy/accessibility release-readiness and evidence consolidation pass; see `docs/LEGAL_PRIVACY_ACCESSIBILITY_RELEASE_READINESS.md`.
