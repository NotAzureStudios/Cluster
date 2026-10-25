# TD6 F11 development-source verification

**Source baseline:** F10 → F11. **Scope:** per-person Package recipient entitlements, independent administrative grants/renewals, revision-qualified revocation, Inbox notifications, and mandatory distribution-gate integration.

Executed against this source tree in the development container (Node.js v22.16.0; standalone TypeScript transpiler for focused route harnesses):

| Check | Result |
|---|---|
| F11 Package entitlement route, approval, revocation and resolver assertions | 24/24 passed |
| Device Package ZIP delivery and device receipt suite, now with grant/deny fixtures | 45/45 passed |
| Device Package reconciliation suite, now with entitlement-aware target projections | 22/22 passed |
| F01 Forms branches | 20/20 passed |
| F02 Forms deadlines | 36/36 passed |
| F03 Card saved edit history | Passed |
| F04 Whiteboard saved operations | 27/27 passed |
| F05 Packet audio | 21/21 passed |
| F06 native Package update-plan integration | 15/15 passed |
| F07 native Package destination-audit integration | 18/18 passed |
| F08 return-to-studio | 18/18 passed |
| F09 engagement expiry/renewal | 17/17 passed |
| F10 scoped Project grants | 21/21 passed |
| Source scan | 1,057 TS/TSX parsed, 0 syntax errors; 3,173 renderer relative imports, 0 missing; 110 CSS files, 0 bracket errors |

Test emphasis: published release/rollout/device PIN is insufficient without an independently approved recipient grant; denied, expired or revoked accounts no longer receive target manifests; direct downloads and native grant issuance share resolver; stale approvals and revocations fail safely; audit/Inbox transaction failures roll back committed permission state in the route harness.

**Unverified (explicitly deferred):** full dependency-backed TypeScript compile (Node 24), generated Prisma client, live PostgreSQL migration execution and concurrent-server transactions, Windows/Qt runtime, OS installer/device agent behavior, and release certification. A short-lived native authorization issued before revocation may live until its own expiry. Historical F01–F10 development checks do not imply broad integration certification.
