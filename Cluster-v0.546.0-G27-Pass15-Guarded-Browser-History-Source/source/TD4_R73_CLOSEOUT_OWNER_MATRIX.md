# TD4 R73 | finite source closeout owner matrix

| Contract | Owner | Evidence/source state | R73 closure posture |
| --- | --- | --- | --- |
| Shared Resource Address / Work Actions | Shared/workflow + owning resource | R57–R60, R71–R73 | Source-integrated; runtime acceptance deferred |
| Project/Board/Card/Library/Packet/Policy discovery | Search + domain authorization | R70 live admission + inherited tests | Source-integrated; live DB/browser gate |
| Source Review Search → active Project repository | Source Control + Search | R71, 26 focused tests | Source-integrated; live Project Source gate |
| Source Commit Search → exact Project placement | Source Control + Search | R72, 33 focused tests | Source-integrated; live Git gate |
| **Studio Form Search and exact navigation** | Studio Systems + Search | **R73, 35 focused tests** | Source-integrated; protected admin-only flow |
| **Non-application submission Search/exact review** | Studio Systems + Search | **R73, 35 focused tests** | Source-integrated; response answers excluded from Search |
| Applications | Studio Applications | Different review workflow | **Not indexed**; must map exact safe destination first |
| Source repository Search | Source Control | Can be secondary binding with no selected destination | **Not indexed**; do not fall back to wrong primary repository |
| Decision/approval Search | Approvals / owning domain | Workspace-level UI exists; exact decision target not proven | **Open**; map real destination and ACL or transfer to TD6 |
| Announcements, automation and other Studio systems | Owning domain | Adapters incomplete | **Open**; no speculative resource kinds |
| Durable outbox typed consumers | Seven startup-owned subscribers | R59/R60/R69 owner/type checks | Source-level lifecycle contracts; live multiworker gate |
| `work.assignment.changed` | Producer + wildcard consumers | Typed/persisted/ordered; no dedicated materializer | **Open** if materialization required; define backfill/offset first |
| Nonconfigurable provider lifecycle | Git / integrations / infrastructure owners | Partly integrated | **Open**: drain/re-enable, revocation and unsubscribe tests |
| Library hierarchy | Library + background jobs | R61/R62 durable moves/archive/trash/restore | Source-integrated; database/filesystem runtime gate |
| Library governance + ownership inspection | Library + storage providers | R63–R68 + approval, simulations | Source-governed; no physical disposition authorized |
| Storage quarantine/disposal/migration/GC | Storage provider owners | Generation/backup guarantees unavailable; unsafe writes fenced | **Intentionally disabled**, explicit TD4/TD5 carry-forward safety gate |

**TD4 source status: OPEN.** Do not equate tests or zipped source with Node 24, PostgreSQL, native Windows/Qt, or NAS/S3 certification.
