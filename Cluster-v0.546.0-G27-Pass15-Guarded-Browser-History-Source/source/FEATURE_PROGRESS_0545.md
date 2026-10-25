# Cluster v0.545.0 | First-class Inventory and Vault tools

## Implemented in source

- **Inventory tool:** Canonical `inventory` route, sidebar icon, command-palette discoverability, role permission, lazy-loaded dedicated workspace. Employees get **My resources**, displaying assigned physical equipment, license seats, and PIN-protected keys. Administrators also have **Assets & allocations** and **Key pools** tabs. Existing asset/edit/return/write-off/transfer/history, encrypted key-pool imports, assignment, redemption, and administrative reveal controls remain wired through the original APIs.
- **Vault tool:** Canonical `vault` admin-only route, independent sidebar icon, lazy-loaded dedicated workspace. Full list/metadata search, cursor pagination, create encrypted records, edit label/classification/expiry without decrypting, audited reveal, rotation, and irreversible revoke. Values are omitted from list requests; reveal values automatically disappear after 20 seconds or on page hiding. Rotation and revocation enforce optimistic revision checks. Clipboard copies disclose system clipboard persistence.
- **Authorization:** Shared permission vocabulary now includes separate Inventory and Vault tool keys; default members/viewers may view their owned Inventory, external collaborators default to none. Vault is admin-only at navigation and API, with inventory pooled keys excluded from generic Vault endpoints. API request routing categorizes personal Inventory and admin Inventory/Vault paths separately. Privileged confirmation headers and security audit requirements are retained; do not mistake this for new MFA enforcement.
- **UX convergence:** Removed Inventory and Vault from the general Studio Settings tab collection and retired its obsolete miniature Vault panel. Settings remains the owner of studio policy/configuration, not operational inventory or secret records. Sensitive operations use the shared confirmation dialogs.
- **Source safety:** No Prisma schema migrations or new OS/native actions. The existing native file updater is byte-identical to v0.544.0.

## Test evidence and outstanding runtime work

- 18/18 new Inventory/Vault route and handler checks, including admin gating, pagination, metadata projection, audited reveal, stale revisions, revocation, and pooled-key restrictions.
- 31/31 inherited Inventory asset behavioral checks; 38/38 inherited Forms checks.
- Source syntax scan: 983 active TypeScript/TSX, zero parse errors; 109 CSS, zero delimiter errors. All active relative imports resolve except the generated Prisma client absent from the lean archive.
- **Uncertified:** full dependency-backed TypeScript typecheck, live Qt/Windows GUI, browser visual tests, fresh PostgreSQL, actual credential encryption provider and runtime authorization matrix. Vault API uses admin authorization and confirmation/audit; separate MFA step-up is not newly implemented in this pass.

**Roadmap:** Inventory and Vault are now independent operational tools, not subpages of Studio Settings. Remaining advanced features include team-scoped Inventory management, supplier/license contracts and external redemption synchronization, delegated Vault roles and credential-use automation. These are future enhancements, not part of the new first-class workspace routes.
