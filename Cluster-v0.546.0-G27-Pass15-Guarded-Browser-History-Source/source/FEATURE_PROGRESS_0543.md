# Cluster v0.543.0 | Inventory recipient workflows

| User journey | Source implementation | Evidence | Runtime status |
|---|---|---|---|
| Admin allocates equipment/seat → user sees custody | Owner-scoped paginated API + My resources cards | API route simulation, UI contract scan | Browser/PostgreSQL pending |
| Admin assigns commercial key → recipient browses nonsecret key metadata | Owner-scoped paginated API; explicit redaction | Ownership, pagination and redaction tests | Browser/PostgreSQL pending |
| Recipient requests key value | Fresh PIN + revision + eligibility + pool + Vault authorization | Incorrect PIN, revoked, stale, closed, unauthorized tests | Real PIN pad/browser pending |
| Privileged disclosure leaves evidence | Audit repository must return success before plaintext response | Audit-failure blocks reveal simulation | Real audit DB pending |
| Recipient conceals sensitive key | Manual hide, 20-second timer, visibility/unmount concealment | Component source contract + TypeScript syntax | Browser behavior pending |
| Vendor key redemption / commercial contract syncing | NOT IMPLEMENTED | Requires vendor API integrations | Out of this Inventory recipient milestone |

The Inventory administration lifecycle from v0.541/0.542 is preserved; no fresh schema migration or native binary update. This is implementation completion in source, not production certification.
