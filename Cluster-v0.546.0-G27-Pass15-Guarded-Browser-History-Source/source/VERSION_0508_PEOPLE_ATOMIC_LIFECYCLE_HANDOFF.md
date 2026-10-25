# Cluster v0.508 | People atomic lifecycle entry

## Changes

- `POST /api/users` now creates user, nested workspace membership, normalized workforce relations and canonical response in one Prisma interactive transaction. Partial workforce failures roll back the login-capable new account.
- `PATCH /api/users/:userId` now updates profile revision, workforce state and workspace role in the same Prisma interactive transaction. Role-write failure cannot partially commit a new profile revision.
- Preserved existing expectedProfileRevision conflict check, manager/capacity checks and security/activity hooks. Created account temporary password is disclosed only after transaction success.
- Central `describeClusterRequest` already classifies privileged account creation and edits as admin-only, enforced by global preHandler before route execution. No duplicate auth service or ACL created.

## Validation

- `node tools/scripts/cluster-0508-people-provisioning-assertions.mjs`: 26 checks after extensions, including executing extracted canonical create/patch closures with mock success, workforce/role failure, and stale revision; also access UI and request policy checks.
- Prior v0.507 suite scripts remain in source for regression. Syntax, imports, manifest, zip and incremental patch replay assessed at packaging.

## Deferred gates / scope

This is *not* a full People Lifecycle implementation. Onboarding/offboarding, account class governance, profile privacy disclosures, session revocations, external invites, employment and returnee handling, full Prisma/PostgreSQL integration, P14/P15 conflict merge and Windows native certification remain to be completed. Application runtime versions have advanced in source but no native executable was built or updated.
