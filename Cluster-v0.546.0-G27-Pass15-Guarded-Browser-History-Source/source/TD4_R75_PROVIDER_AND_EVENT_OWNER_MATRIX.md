# TD4 R75 | finite provider, event and resource ownership audit

**Status rule:** Source-implemented is not runtime-certified. Nothing below grants physical storage disposal rights.

| Contract | Owner | Verified source state | Still required |
| --- | --- | --- | --- |
| Typed outbox delivery, lease/order/consumer obligations | `DurableDomainEventRuntime` | R59/R60/R69 typed obligations; 51 inherited suites green R75 | Live multiworker PostgreSQL, forced shutdown and replay |
| Resource-change, read-model, notifications, automations, Search activity, webhook fanout | Seven composition-owned consumers | Startup verifies owner key AND event family | Restart/disable integration and live end-to-end subscription acceptance |
| `work.assignment.changed` | Producer + wildcard consumers | Persisted with canonical resource identity; no dedicated state materializer | Decide whether a new materializer exists; if yes, specify backfill / replay cutoff, idempotency, ACLs and lifecycle; otherwise document signal-only use |
| Source Control / Git provider | `server-source-control-runtime` and durable jobs | **R75** sync/workflow preflight rechecks connection, Studio scope and working-copy Project binding | In-flight remote cancellation, disable/re-enable acceptance, token rotation while running |
| Discord outbound delivery | `server-discord-runtime` and receipt recovery | **R75** exact destination, routing policy and connection reauthorization twice per dispatch; recovery task owned by server background registry | Multi-process concurrent delivery, sender in-flight revocation; investigate durable receipt race/idempotency at provider boundary |
| Discord background receipt recovery | `BackgroundTaskRegistry` server maintenance | Adaptive bounded task and shutdown owner registry; pending receipts persisted | Startup/drain/restart/live delivery reconciliation and provider interruption |
| Webhook consumer and sender | `integrations.webhooks` | R60 endpoint policy revocation, delivery checks and shutdown ordering | Actual HTTP in-flight revocation/races and server crash |
| Studio tool availability | TD2 six configurable tool owners | Server Settings reconciler and job claim/exec gates | Live cross-process settings propagation and multiuser authorization |
| Storage lifecycle / orphan / retention evidence | Storage + Library | R63–R68 inspect/approval/simulation; dangerous mutation paths held | TD5 verified provider generation, backup retention, quarantine rollback and delayed destruction |
| Search/Work Actions: standard Project/Library/Packet/Policy | Domain ACL + Search | R70 current-record admission | Live authenticated permission-revocation test |
| Source Reviews/Commits | Source Control + Search | R71/R72 current Project/primary binding placement | Native and browser exact-target acceptance |
| Studio Forms/Submissions | Studio Systems + Search | R73 private admin-only projection and exact record | Multiuser privacy/denial acceptance |
| Approvals | Admin Decisions + Search | R74 admin-only admission/exact target | Live admin/role revocation test |
| Announcements, public applications, automation, secondary repository results | Respective TD6 domain owners | Excluded rather than routing to unrelated destinations | Build genuine target semantics and Search adapters in TD6 |

## Explicit source safety boundaries

- Admission checks are performed near remote dispatch, but a remote request **already sent cannot be recalled**. Git remote work needs further cooperative cancellation/generation fencing if strict mid-flight revocation is required.
- Project links and provider status are read authoritatively, never inferred from the durable job payload.
- `work.assignment.changed` is not currently a standalone materialized projection. Adding a new consumer to an already-active durable outbox requires designed replay/backfill or cutoff semantics.
- TD4 remains **source-open** until the ownership decisions above are signed off and negative contracts audited. TD5 and TD6 carry-forwards remain explicit, rather than implied completed features.
