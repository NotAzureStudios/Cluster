# G25 → G26 source handoff

**Canonical complete source:** `Cluster-v0.546.0-TD6-G25-Workstream17-Source-Closeout-Source.zip`. Parent G25 WS16. **TD0–TD5 and G25 are source-closed only;** release certification is separate. G26, G27, G28 and TD7 remain.

## Preserve the G25 convergence

- `Card.ticketStage` controls Tickets in triage, Admin, Search, Automations, Project closeout and Project delivery. **`resolved` is not `rejected`**, and neither derives from List `isDone`. Ticket analytics uses the canonical Prisma `boardList` delegate. The renderer now offers separate Rejected queue.
- Default Boards are blank, Ticket intake requires explicit valid destinations, archived List recovery retains data/history, unsafe permanent deletion is blocked. New SQL Card admission trigger and named 409 mapping require applied migrations and real PostgreSQL concurrent transaction acceptance before claiming complete concurrency certification.
- Card, List, Whiteboard and discussion history are revision-guarded, offline mutations cannot be discarded without explicit confirmed resolution, content mergers revalidate against current state.
- Form reviewer grants/assignment privacy, per-occurrence Calendar resource capacity, bounded recurrence, Source→Build→QA→Project closeout authority remain canonical.

## G26 grouped implementation order (one broad batch, not isolated micro-phases)

1. **Library + Viewer + Packets:** recipient-safe derivative authorization and per-version approval, contextual media review and stable preview state, bulk operation scope, import/download evidence, document watermarking policy and content safety. Reuse existing Library service, media jobs, storage ownership and viewer components.
2. **Transfer Center + stream durability:** large file streaming, pause/resume/cancel semantics, real byte/job progress, quota and content authorization, offline and stalled transfers. Avoid extra duplicate background polling; measure request/log volume.
3. **Packages + Inventory/Vault + desktop staging:** native entitlement checks, staged archive verification, safe update/repair/rollback checkpoints, reviewed install grants and per-profile isolation. Never bypass TD5 physical disposal hold.
4. **UI polish in same workflows:** full-window media stage, resizable inspector, dense Library table with selection scope, clear version-bound review decision, no decorative fake progress; follow CL-DS-001 design records.

## Mandatory tests / deferred evidence

- Real Node24 generated Prisma/build and PostgreSQL migration execution still unperformed. Include dedicated two-connection List archive/Card insert and Board archive/insert race cases in native integration certification.
- Recheck G25 end-to-end, not just a source scan, during G28 and final certification. Use user-specific auth, live multiuser, reconnection, zero-length saved automations, permission revocation, QA provenance and Calendar collisions.
- Reference `TD6_G25_WORKSTREAM17_SOURCE_CLOSEOUT.md` and `TD6_G25_WORKSTREAM16_TO_G25_CLOSEOUT_HANDOFF.md`; past embedded G-number documents are historical.
