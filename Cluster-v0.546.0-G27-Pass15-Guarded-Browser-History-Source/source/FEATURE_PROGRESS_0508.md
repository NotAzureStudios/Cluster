# Cluster v0.508 | People, Forms, Packets, Inventory and Vault

**Status:** v0.508 source development transitioned to v0.509. Features below are foundations, not end-to-end certified delivery.

| Workstream | Source status | Next action |
|---|---|---|
| People account provisioning | Implemented, mock-transaction tested | PostgreSQL tests, invitation/onboarding path, account types, approval and offboarding |
| People profile + workspace role | Implemented, mock-transaction tested | Role-policy validation, lifecycle consequences, session/access revocation testing |
| Identity/profile privacy | Reuses existing central admin request boundary | Real multi-account and private-field disclosure tests |
| Company/Project grants | Studio/Team policies and Project restrictive ceilings exist; per-person scoped grants outstanding | Safe positive grant administration, access provenance, no Library bypass |
| Forms | Hardened shared validator, acknowledgement + option/schema validation and closed-version submission rules | Full form authoring UX, access/privacy integration and real runtime acceptance |
| Packets | Immutable hashed source-manifest publication foundation and author UI | Real derived artifact generation, entitlement delivery, revision pinning, source-distribution enforcement |
| Inventory/Entitlements | Asset and allocation tables, locked seat allocation, admin UI and transactional offboarding cleanup | Key pools, multi-user runtime, entitlement policy, asset lifecycle and reconciliation |
| Vault | Encrypted secret records, metadata-only list, MFA-gated audited reveal/rotation/revoke API and create UI | Authenticator/browser flows, encrypted recovery, entitlement linkage and security certification |

## Release requirements preserved

- Validate identity, workspace membership, normalized employment and roles atomically.
- Explicit distinction between Account Type, Employment/Engagement, Role, Permission Bundle and Project Membership.
- Never allow Packet entitlement to confer canonical Library source access.
- Sensitive secrets must not enter normal search, logs, notifications, profiles or exports.
- Runtime tests and authorititative Pass 14/15 conflict review remain open; do not promote source checks into certification.

Next substantial v0.508 batch: identity/account lifecycle, People onboarding/offboarding coordination and Forms shared authoring foundation. Continue through v0.508 until the next version boundary under the user's milestone-based cadence.

## October 8 milestone exit: v0.508 to v0.509

- **People:** Atomic account creation/profile updates retained from entry; active Inventory allocations participate in offboarding impact, physical return/waiver gate and transactional revocation. Full account-type/engagement lifecycle and real account federation remain open.
- **Forms:** Server-side validation for acknowledgement true, field types, dates, membership, lengths and duplicate schema keys. Both signed-in and public submissions respect the most recent published/accepting version.
- **Packets:** Hashed immutable author-only source manifest snapshots, publication guard, Packet editor action. This is **not** recipient distribution or protection from download of source via other routes.
- **Inventory:** PostgreSQL models/migration for assets and allocations, row-locked capacity check, admin asset/assignment UI, offboarding integration. No seat-key exchange or physical-device management agent implemented.
- **Vault:** Encrypted values have a dedicated model, require configured encryption key, are excluded from list projections, and are logged on reveal/rotation/revocation. Reveal requires fresh single-use MFA and typed confirmation. UI currently only supports metadata/create; reveal/rotate is a protected API requiring secure client UX.
- **Safety:** Inventory and Vault tables, hashed Packet releases, no implied Library source access from Packets.
- **Validation:** Source/static checks and mock route tests only. PostgreSQL migration execution, full dependency-backed TS compile, live MFA, real multi-admin seat contention and Windows runtime are not tested.
- **Integration blocker:** Existing source lineage remains unmerged with authoritative Pass 14/15. Never replace it as a production baseline without conflict review.
