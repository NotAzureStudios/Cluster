# TD6 F08 — Governed Return to Studio

## Implemented source files

- `apps/server/src/domains/studio-systems/studio-return-eligibility.ts`: shared fail-closed case/account eligibility and access-expiry validation.
- `apps/server/src/domains/studio-systems/studio-offboarding-routes.ts`: authorized return preview, transactional one-time return, locked identity, confidential evidence, security resets and safe result projection.
- `apps/server/prisma/schema.prisma` + `20261018180000_td6_f08_return_to_studio/migration.sql`: case return lifecycle fields, author and indexed provenance; immutable existing completed case outcome retained.
- `packages/shared/src/studio-systems-contracts.ts`: explicit return request contract, revision/confirmation/reason/account type/access expiry.
- `packages/renderer/src/features/settings/StudioOffboardingPanel.tsx`: preview first, subsequent type/expiry/reason confirmation, disabled-account feedback, return marker on completed case.
- `apps/server/src/domains/users/user-directory-routes.ts`: profile PATCH no longer archives/unarchives identities or mutates archived people outside governed lifecycle.
- `apps/server/src/domains/auth/auth-admin-routes.ts`: archived/erased/expired credential reset/set and account activation guards.
- `apps/server/src/domains/auth/auth-discord-routes.ts`: freshly read account state before Discord callback activation.
- `packages/renderer/src/features/people/PeoplePages.tsx`: removes ungoverned Archive/Restore toggle and directs admins to Offboarding.
- `tools/scripts/cluster-td6-people-return-tests.mjs`: eligibility and in-memory transactional handler checks, fault rollback, secrecy/permissions, source integration.

## Safety model

The return restores only an *identity*, not employment, access or old responsibilities. A newly enrolled person cannot use their old password or Discord account to resume previous authority. Existing offboarding evidence and transferred assets are not rolled back. New provisioning of credentials, roles, workspace/team/project permissions and required agreements must be separate authorized actions, subject to current Studio defaults.

The return is one-time per completed case. A later departure and return requires a new offboarding case; old case return endpoints fail. Transactions require locking the person row, checking the most recent case and profile state, and atomically writing the return and personnel evidence. No automatic account activation occurs in this route.

**Limits:** This is source-level work, not fully certified migration execution, concurrent live PostgreSQL race verification, MFA reenrollment UX, or OS/Desktop runtime testing. The source helper does not claim automated deprovisioning at expiry. Admin credential provisioning still follows existing separate auth policies and should be reviewed in the final permission matrix.
