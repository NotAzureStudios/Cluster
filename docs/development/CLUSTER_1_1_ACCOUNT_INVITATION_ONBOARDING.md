# Cluster 1.1 — Account Invitation and First-Login Closeout

**Status:** Security/UX implementation backlog. The UI handoff for the existing temporary-password protocol is implemented in PR #70; the invitation protocol below is **not implemented or deployed**.

## Observed problem (November 4, 2026)

The studio owner created an account and the member later required administrator intervention to set a password. In current source, `POST /api/users` generates a temporary password, stores only its hash, sets `PASSWORD_CHANGE_REQUIRED`, and returns the plaintext once to the administrator. `/api/auth/login` accepts that temporary password, then `/api/auth/session-password` requires the member to choose a permanent password before completing first login.

**Immediate repair:** Put an unavoidable one-time credential handoff in People creation and password-reset workflows, with username, copyable private instructions, and explicit member-owned password setup. Never store or transmit the temporary password automatically.

**Desired 1.1 workflow:** New members should have an independent, secure invitation activation path rather than requiring administrators to distribute a temporary password.

## Proposed member journey

1. Owner/admin creates a **pending invitation**, selecting role/access, account type, scope, expiration and verified recipient address or manual handoff.
2. Cluster produces a **short-lived one-time activation link** only after the server commits its hashed token and invitation record. The admin may copy it deliberately for a private channel; where a trusted mail adapter exists, the server may deliver it after the admin authorizes sending. Do not default to publicly visible URLs or automatic Discord posts.
3. Member opens the link on the same server. After validation and rate limits, member sets their own password or registers an allowed passkey. No browser session is granted solely from knowing an untrusted username or email address.
4. Cluster atomically consumes the invitation and activates the account under its intended membership and access policy, then continues MFA, required agreements, profile setup, workspace tour, and assigned onboarding tasks.
5. Admin can see invitation lifecycle without seeing secrets again: **Pending → Delivered/Shared → Accepted → Expired/Revoked**, plus clear resend/replace with explicit invalidation.
6. Existing accounts use a **separate governed recovery flow**, with no public self-escalation of roles, MFA strength or expiry. Contractors, guests, service identities and device accounts follow their correct account-type policies.

## Security contracts and requirements

- Random high-entropy token, hash-only at rest (not plaintext); one-time consumption, atomic compare-and-swap, expiration and generation binding.
- Single canonical studio/workspace identity, role scope and account policy authority; no duplicate identity repository.
- Rate limits and generic responses to unauthenticated malformed/expired tokens to limit enumeration; no long-lived token caches in client storage.
- No secrets in logs, analytics, referrers, third-party scripts, chat notifications, browser history, or exception telemetry. Limit or clear URL token as early as possible in the authenticated activation experience; set restrictive referrer policy.
- Safe multi-tab concurrency and a clear expired/consumed/revoked display; no resurrection of disabled, suspended, expired, archived or privacy-erased accounts.
- Enforce password policy server-side, session generation and verification revocation on reset, MFA/owner protections, audit receipts and notification lifecycle.
- Server-generated invitation deep links must use a configured approved public origin, not untrusted `Host` or forwarded headers.
- Preserve the existing manual temporary-password path until the new invitation lifecycle has behavioral and Windows runtime acceptance, then retire duplicate internal flows as a deliberate contract change.
- No automatic account creation by external identities, public sign-up or speculative legacy migration.

## Verification before delivery

- Invite create/accept/expire/revoke, second-use rejection, invalid/unknown token, rate limits, expired account, disabled role, unsafe origin, concurrent acceptance.
- No token in logs, DOM after consumption, download files, background cache or persisted offline drafts.
- Password setup, PIN/MFA gate, device session rotation, agreements, onboarding plan, role privilege preservation, service/guest/contractor boundaries.
- Email-less secure manual handoff, optional tested email adapter, inaccessible/expired invitation recovery, narrow-screen and keyboard/assistive-tech first-run UX.
- Web and actual Windows Server integration, local and remote session, reconnect and server version compatibility.

## Task health follow-up

The November 4 live server screenshot establishes degraded **background-tasks** health but not the failing task identity. Current `assessOperationalHealth` uses at least **3 consecutive failures** for warning and **8** for failure. Admin `GET /api/admin/operations/health` already returns authoritative scheduled task snapshots containing `name`, `consecutiveFailures`, and `lastError`. New on-demand Operations Center UI displays this evidence; **do not mute/suppress alerts or assume success** until the identified task has been repaired and two healthy samples confirm recovery. Existing incident acknowledgements are separate.
