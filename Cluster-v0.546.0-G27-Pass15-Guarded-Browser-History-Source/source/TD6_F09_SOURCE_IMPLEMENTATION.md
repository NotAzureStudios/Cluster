# TD6 F09 · Governed access renewal source implementation

## Production source touched
- `apps/server/src/domains/users/studio-access-renewal-policy.ts`: expiry / stale-review invariants.
- `apps/server/src/domains/users/studio-access-renewal-routes.ts`: authorized, two-person transaction request/review endpoints; confid. audit & actionable notifications.
- `apps/server/src/domains/users/studio-access-expiry-lifecycle.ts`: durable, idempotent staged notices and session revocation.
- `apps/server/src/domains/users/user-directory-routes.ts`: ordinary expiry-edit bypass blocked; external account creation requires valid future expiry.
- `apps/server/src/app/cluster-server.ts` and `apps/server/src/app/server-job-runtime.ts`: route and durable hourly job registration.
- Prisma schema and `20261018193000_td6_f09_access_renewal` migration: two explicit models and relation/index authority.
- `packages/renderer/src/features/settings/StudioAccessRenewalsPanel.tsx` and `StudioSystemsSettingsSection.tsx`: request/review interface.
- People and Admin profile surfaces: correct read-only renewal posture; guarded external-account creation.

## Invariants / caveats
- Two different active administrators are required for request and decision; the subject cannot self-approve. At present this is a policy choice, including for small studios with only one admin.
- Renewal grants no workspace/project/tool permissions, employment, inventory, licenses, PINs, passwords or new application access by itself.
- No physical Library deletion or unattended OS installations were introduced.
- Source-scan and fake/in-memory transaction checks are not substitutes for real PostgreSQL concurrency or Windows/browser acceptance. Do not claim full certified release.
- The session revocation sweep is hourly and bounded. The existing authorization engine rejects expired access without waiting for the sweep. Larger studios need pagination before exceeding 500 due accounts or 500 administrators.
- Both F08 and F09 keep private Personnel Record provenance immutable via source kind/id uniqueness; no previous offboarding evidence is altered.
