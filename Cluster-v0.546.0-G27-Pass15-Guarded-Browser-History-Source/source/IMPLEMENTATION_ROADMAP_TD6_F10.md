# Cluster v0.546.0 · TD6 F10 implementation roadmap

**Authoritative source:** TD6 F10 supersedes F09 for development. **Standing order:** finish unfinished code; run targeted regressions; TD7 and comprehensive runtime/release certification follow later.

| Slice | Implemented feature source | Runtime certification |
|---|---|---|
| F01 | Conditional Form branches and hidden-answer filtering | Deferred |
| F02 | Form deadline/reminder pipeline | Deferred |
| F03 | Saved Card metadata Undo/Redo | Deferred |
| F04 | Saved Whiteboard operation Undo/Redo | Deferred |
| F05 | Detached Packet WAV previews | Deferred |
| F06 | Native managed Package update/conflict plan | Deferred |
| F07 | Read-only Package installation destination integrity | Deferred |
| F08 | Governed return-to-studio | Deferred |
| F09 | Two-person account-expiry renewals and expiry notices | Deferred |
| **F10** | **Independently reviewed Project member grants/renewals, bound to identity expiry; additive authorization, denies respected, confidential decision evidence and Settings UI** | **Deferred** |

## F10 access governance

- The canonical **AccessRule** enforces the approved grant; `StudioScopedGrantRequest` is workflow/history only and pending records never authorize anything. `AccessRule.governedGrantId` marks reviewed personal grants as additive rather than exclusive to one person.
- Studio Systems → Scoped Grants supports Request Grant / Extend Grant and separate Approve / Reject decisions. People management **and** current Project management permission are checked at request and review. Reviewer must differ from requester and recipient.
- Project targets only. Direct member `allow` Access Rule creation or elevation in the old REST routes and direct `User.projectPermissions` profile edits are rejected; non-grant denials and archiving remain possible. Existing ProjectMembership roles and tool-wide permissions are independent authorities, not automatically converted to temporary grants.
- Grant expiry must be after now, no more than **180 days**, and no later than the recipient's identity expiry. A temporary Project grant never renews an expired account, overrides archived/disabled identities, or restores old offboarded grants. Time comparisons are evaluated authoritatively on requests, reviews and access resolution, not delegated to background workers.
- Request and decision use one transaction, advisory lock per subject/Project, stale profile and Access Rule fingerprint checks, duplicate pending database index, plus confidential finalized Personnel Record. Failed evidence write rolls back the permission mutation. Decision Inbox actions resolve at commit and eligible recipients get result notifications.
- Governed allow rules are **additive** to inherited Project baseline access, not exclusive allowlists. Matching explicit deny, preexisting restrictive/exclusive rules and Project Tool Config ceilings still win. A grant's expiry revokes **only its additional privilege**; inherited baseline view may remain.
- Sensitive Library source/folder ACLs, Inventory/seat/license grants, Packet recipient distribution, Package deployment entitlements and Team/ProjectMembership authorities require their own scope-aware implementations. F10 does not claim to manage those.

## Next: F11

Complete **Inventory/Package entitlement administration**, rather than treating a Project AccessRule as an entitlement for keys/software. Map canonical Inventory/License/Package recipient authority first; then implement scoped requests, expiry/revocation, provisioning evidence, and UI. Continue remaining TD6 CD-01–CD-20 ledger without dropping small wins.

## Certification not yet done

No dependency-backed Node 24 build, live PostgreSQL migration/authorization matrix, authenticated browser/Qt/Windows acceptance, S3/SMB storage testing, concurrency across actual server processes, or final product/release certification. No physical Library destruction is enabled by F10.
