# TD4 R76 | final finite owner and transfer matrix

| Contract / resource | Authoritative owner | TD4 source disposition | Carry-forward acceptance |
|---|---|---|---|
| Canonical resource identity, project scope, desktop links | Shared manifest + renderer/navigation | CLOSED R57/R58 | Native Qt/Windows protocol delivery: certification |
| Projects/Boards/Cards/Library/Packets/Policy/People/Calendar/Builds/QA/comments/Activity Search | Server Search + per-domain ACL/live admission | CLOSED R70 | Multi-user denial/revocation: certification |
| Source Review exact navigation & index | Source Control + Search | CLOSED R71 | Primary-binding browser/native acceptance |
| Source Commit exact navigation & index | Source Control + Search | CLOSED R72 | Shared-repository permission/placement acceptance |
| Studio Forms and private submissions | Studio Systems + Search | CLOSED R73 | Multi-user admin privacy/denial acceptance |
| Approval exact navigation & index | Admin Decisions + Search | CLOSED R74 | Administrator access/revocation acceptance |
| Durable typed outbox | `DurableDomainEventRuntime` | CLOSED R59/R60/R69/R76 | PostgreSQL multi-process lease/restart certification |
| Resource-change wake (`*`) | `resource-change-runtime-wake` | REQUIRED / CLOSED | Restart/resubscription acceptance |
| Project read-model invalidation (`*`) | `projects.read-model-invalidation` | REQUIRED / CLOSED | Cross-process propagation acceptance |
| Webhook event fanout (`*`) | `integrations.webhooks` | REQUIRED / CLOSED | Provider in-flight / crash acceptance |
| Activity notification materialization | `notifications.materialize-activity` | REQUIRED / CLOSED | Real notification delivery |
| Studio automation activity | `automation.studio-activity` | REQUIRED / CLOSED | TD6 future automation behavior |
| Project automation activity | `projects.automation-activity` | REQUIRED / CLOSED | TD6 future automation behavior |
| Search Activity changes | `search.activity-changes` | REQUIRED / CLOSED | Live permission revocation |
| `work.assignment.changed` | Domain tables + generic wildcard event consumers | **SIGNAL-ONLY / CLOSED**; no dedicated materializer | New projection only if TD6 specifies backfill/cutoff and ACLs |
| Background Tool availability | TD2 `BackgroundTaskRegistry` + durable job worker | CLOSED six owner contracts; R75 provider gates | Multi-process disable/re-enable acceptance |
| Git provider jobs | Source Control runtime | CLOSED queued-work preflight R75 | TD5 in-flight network cancellation |
| Discord receipts | Discord production runtime | CLOSED queued route/connection revocation R75 | TD5 network/interruption/idempotency proof |
| Library bulk, hierarchy, lifecycle | Library domain job services | CLOSED R61/R62 | PostgreSQL/file relocation acceptance |
| Disposition policy/evidence, approval, simulation | Library domain governance | CLOSED R63–R67 | TD5 quarantine execution/recovery |
| Provider-safe physical delete, migration, GC | Storage provider | **DISABLED, explicitly transferred TD5** | Generation fence, retained backups, atomic quarantine, recovery |
| Announcement / application / automation Search targets | Owning application domain | **INTENTIONALLY EXCLUDED**, transferred TD6 | Real destinations, ACLs and exact hydration |
| Secondary Git repository destination | Source Control UI | **EXCLUDED**, transferred TD6 | Verified target UI before Search index |

**Boundary:** Source-closed is not runtime-certified. Any missing first-party *enabled* owner discovered by real source testing reopens TD4 as a demonstrated regression only.
