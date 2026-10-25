# v0.542 → v0.543 handoff

Use `Cluster-v0.543.zip` as the new complete source baseline. v0.543 stays in Inventory and implements the **recipient side** of v0.541 assets/allocations and v0.542 Vault-backed commercial key pools.

## What changed

- `apps/server/src/domains/inventory/studio-inventory-vault-routes.ts`: added owner-only `/api/me/inventory/allocations` and `/api/me/inventory/keys` pagination plus PIN-protected `/api/me/inventory/keys/:id/reveal`. Lists never include secret material. Reveal has required persisted audit, status/revision checks, and active-user/pool/Vault protection.
- `apps/server/src/app/cluster-server.ts`: wires existing auth, PIN, and audit dependencies into Inventory routes.
- `packages/renderer/src/features/settings/MyInventoryLicensesPanel.tsx`: recipient custody, license, and game-key view, protected reveal, copy, concealment, and pagination.
- Account Settings section registry/type/page: adds **My resources** without adding a new global navigation tool.
- Inventory focused tests: actual mocked route behavior for unauthorized, stale, revoked, and audit-failure disclosures, plus pagination and redaction. Inherited structural assertion counts updated for added endpoints.

## Do not regress

1. Vault remains the sole owner of ciphertext. No ordinary list response may include Vault secret IDs, fingerprints, encrypted bytes, or key values.
2. Recipients see only their own assignments. Do not turn a self-service list into an Admin data projection.
3. PIN verification is mandatory for revealing assigned keys. Audit persistence must succeed before disclosure. Closed/revoked/redeemed keys cannot be revealed.
4. No key value in local preferences, URL, activity text, notification bodies, logs, or long-lived cache. Explicit clipboard copies are outside Cluster's control.
5. Preserve commercial key-pool administrator operations and the existing native file updater without changes.

## Boundaries / next area

No new database migration. Previous Inventory migrations still need real PostgreSQL application. Full TypeScript dependency compilation, browser/native UI, and Windows runtime certification remain intentionally deferred. Vendor redemption and contract synchronization are later integrations, not a reason to keep tweaking Inventory. With the two Inventory milestones and this recipient milestone, prioritize a different **unfinished** substantial subsystem (e.g., Forms) and complete its full UI/server flow before moving on.
