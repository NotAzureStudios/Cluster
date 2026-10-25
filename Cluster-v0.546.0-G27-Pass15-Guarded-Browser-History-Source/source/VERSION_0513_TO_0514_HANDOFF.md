# Cluster 0.513.0 → 0.514.0 | Signed device delivery feature handoff

Baseline archive: `Cluster-v0.513.zip`, which carries the authoritative Pass 13/15 source merge. Retain all pre-v0.514 features; this checkpoint extends the Managed Package system only and tightens device revocation.

## Key source files

- `apps/server/src/domains/inventory/managed-package-device.ts` — bounded signed device target resolution and manifest signature verification.
- `apps/server/src/domains/inventory/managed-package-routes.ts` — verified-desktop-session feed, transactional authenticated binary delivery and audited evidence; admin archive preview guard.
- `apps/server/src/domains/inventory/managed-package-policy.ts` — stronger ZIP local-header, CRC, inflation and overlap validation.
- `apps/server/src/domains/sessions/session-routes.ts` — atomic device/session/Package-pin revocation.
- `apps/server/src/app/cluster-server.ts` — inject canonical `getCurrentSession` into Package routes.
- `packages/renderer/src/features/settings/StudioManagedPackagesPanel.tsx` — delivery audit history.
- `tools/scripts/cluster-0514-device-package-delivery-assertions.mjs`, `cluster-0514-device-revocation-assertions.mjs` — executable source-driven tests.

No Prisma schema change was necessary; the package audit and DeviceRegistration tables already exist. Delivery audit stores a hashed artifact identity and device-registration reference, **never an installed flag**. The broader package deployment/install workflow still requires trusted native agent work.

**Boundary:** The device proof endpoint is tied to existing sessions and verified device registrations; it does not independently establish a hardware-backed device identity or guarantee that a downloaded file is safely executable. Native installers must pin signing trust independently, validate ZIP contents and expected release hash, sandbox or constrain install targets, perform atomic activation and rollback, and issue trustworthy installation receipts. Never execute delivered archives on the server.

**Run tests:** `node tools/scripts/cluster-0513-managed-packages-assertions.mjs` and `node tools/scripts/cluster-0514-device-package-delivery-assertions.mjs` and `node tools/scripts/cluster-0514-device-revocation-assertions.mjs` with TypeScript dependency installed. Run existing inherited regression suites and static scan. Dependencies/native/PostgreSQL have not been compiled or certified by user direction.
