# F10 Implementation Notes

**Checkpoint:** Cluster v0.546.0 / TD6 F10. **Source-implemented** only, not runtime-certified.

- Added governed Project personal grants/expiry extensions without affecting account expiry; approval commits canonical AccessRule only at review.
- Peer-review separation, Project plus People authority, workspace eligibility, expiration and profile-version checks, existing-rule revision checks, transaction advisory locks, duplicate pending partial unique index.
- Added `governedGrantId` marker and authorizer additive matching semantics, preserving unmatched viewers' baseline and the precedence of deny/exclusive policy. Updated explanation contributors through existing AccessRule evidence.
- Removed profile-side project override editor and blocked direct elevated member AccessRule route mutations. Project Tool permissions and role/membership grants still have separate authority; F10 is *not* a blanket authorization rewrite.
- Added Studio Systems Scoped Grants admin panel, Inbox action-to-decision linkage and confidential finalized Personnel Records.
- Added focused executable policy/route/transaction/authorization tests and parent regressions. No live PostgreSQL/Qt/Windows evidence was produced.

**Known gaps:** project-only personal grant scope; Inventory, seat/license, Package, Packet, Library source and Team-level entitlements require canonical domain-specific integration; any legacy `User.projectPermissions` overrides can still affect access until TD7 source convergence. Existing implicit Project view may remain after grant expiry.
