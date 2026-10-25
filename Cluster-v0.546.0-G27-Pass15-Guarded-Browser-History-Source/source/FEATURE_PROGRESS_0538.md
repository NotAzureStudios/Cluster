# Feature Progress 0.538 (source-level)

| User journey | Before | After | Still required for certification |
|---|---|---|---|
| Cancel pending offboarding | API existed, no Admin action | Reason-confirmed Admin cancellation, revision checked | Browser/DB execution |
| Avoid duplicate offboarding cases | Existence precheck raced with another admin | Per-subject PostgreSQL row lock and transactional confidential record creation | Concurrent live DB test |
| Record equipment or complete offboarding | Server CAS, stale Admin views could execute | Reviewed-revision requirement through server + UI | Live multi-admin exercise |
| Publish onboarding version to audience | Version could commit before assignments failed | One atomic version/assign/supersede/activate transaction | DB transaction load test |
| Compose onboarding sequence | Append/delete steps only, duplicates possible | Reorder steps; reject duplicates in backend contract | Browser/keyboard UX |
| Recover uncertain onboarding mutation | Retry could replay writes | Reconcile server state rather than replay | Network-fault browser test |

This milestone intentionally leaves full certification deferred; it removes implementation gaps without claiming app-runtime proof.
