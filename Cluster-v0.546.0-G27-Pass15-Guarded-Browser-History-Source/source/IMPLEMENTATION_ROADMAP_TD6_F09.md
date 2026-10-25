# Cluster v0.546.0 · TD6 F09 implementation roadmap

**Canonical source:** F09 is the successor of F08. **Standing priority:** finish incomplete application code, retain focused source regressions, defer Node 24 dependency-backed compilation, live PostgreSQL migrations, Windows/Qt/browser acceptance and full release certification.

| Slice | Source-complete change | Certification |
|---|---|---|
| F01 | Conditional Forms and hidden-answer filtering | Deferred |
| F02 | Form deadlines and durable reminders | Deferred |
| F03 | Reversible saved Card metadata operations | Deferred |
| F04 | Collision-checked Whiteboard saved history | Deferred |
| F05 | Detached Packet WAV audio previews | Deferred |
| F06 | Native managed Package update plans and conflict evidence | Deferred |
| F07 | Read-only tracked destination integrity audits | Deferred |
| F08 | Governed return-to-studio and credential quarantine | Deferred |
| **F09** | **Two-person engagement access renewal, future access expiry validation, administrator notices, expiry-session revocation, confidential decision evidence** | **Deferred** |

## F09 CD-04 completion slice

A canonical `StudioAccessRenewal` request captures the previous expiration, intended new expiry, subject profile revision and business reason. People managers request the change. A distinct authorized People manager decides it, cannot approve their own request or their own access, and repeats access, revision and identity checks inside one PostgreSQL transaction. Approval extends **only** `User.accessExpiresAt` and increments profile revision. It does not change roles, employment, project/workspace/team grants, credentials, inventory or Package assignments.

- No direct account-expiry PATCH or profile-edit bypass. External account creation must have a valid future expiry. Employee accounts can still be permanent at creation but cannot invoke renewal without a previous expiry.
- Requests notify eligible peer administrators and reject if there is no possible independent reviewer. Decisions close the actionable alert and notify currently eligible requester/subject accounts.
- Each decision creates a **confidential finalized Personnel Record** with unique source provenance in the same transaction. Duplicate and stale decisions fail with no partial activation.
- Expired access is denied **immediately** by the existing authorization engine. A new durable hourly sweep delivers a once-per-expiration 7-day, 24-hour or expired Inbox notice and revokes stale sessions after expiration. Notice and session mutation commit atomically; sweeps fail explicitly when their bounded scan/recipient limits would omit people.
- Expired renewal approval still forces fresh authentication and invalidates old sessions. It does not reactivate an archived/disabled/erased account or restore prior grants.
- Dedicated Studio Settings → Studio Systems → Access renewals UI exposes expiring people, new requests, peer review and decision history. The People profile continues to display expiry read-only. Historical Admin profile edits omit unchanged expiry fields.

## Still unfinished

- **CD-04:** richer person/engagement classification, optional service/device account lifecycle, explicit grant/entitlement request/approval workflow and expiry/revocation for each authority, offboarding portfolio access, roster-scale paginated expiry sweeps, delegated review/notification preferences.
- **CD-08:** OS-level supervised software install/update/dependencies and installer rollback; F06/F07 remain managed-content functionality, not a Windows installer.
- **CD-03:** broader collaboration and Undo/Redo outside Card metadata and selected Whiteboard operations.
- **CD-07:** further media derivative formats, optional full transcoding and retention/watermark policy.
- Remaining **CD-01–CD-20** feature ledger entries remain preserved; do not call any workspace complete merely because one slice passed source checks.

**Next F10 preferred:** authoritative, time-bounded entitlement and grant approvals across Projects/Tool/Inventory/Package recipients, without allowing an access renewal to restore historical grants. Keep implementation-first ordering.
