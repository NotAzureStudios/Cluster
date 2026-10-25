# UX-G25-17: source-closeout Ticket outcomes and Project action trust

- `change_id`: UX-G25-17
- `problem`: Project closeout and Ticket analytics misclassify unresolved/rejected Tickets; grouped facets query a nonexistent delegate; archived List races can admit hidden work.
- `current_goal`: truthful, compact triage and closeout; visual distinction between resolved versus rejected; no false durable success.
- `historical_decisions`: earlier generic Board List-based completion **superseded** by G25's Ticket-stage authority. Independent Board Cards remain column-based. Blank Boards and explicit destinations **active**. External CL-DS-001 v1.3.0 **active policy**; not falsely represented as embedded source documentation.
- `source_evidence`: Project closeout route, Ticket analytics, shared data fields, Ticket System Page, Card admission migration, focused tests.
- `scope`: Project closeout, Tickets, analytics/saved views, Card/Ticket archival race, browser/desktop semantic outcome.
- `reuse`: current Card stage, BoardList, shared Data View semantic fields, Ticket queue tabs, API error normalizer, existing Prisma transaction and migrations.
- `behavior`: Rejected Tickets get a labeled queue distinct from Resolved; Project closure checks independent Card and Ticket gates; storage archive races return actionable HTTP 409. Keyboard/touch controls reuse existing ClusterButton and layout primitives.
- `states`: open, waiting, review, resolved, rejected, concurrency-conflict, archived-destination-denied. No optimistic database success.
- `migration`: no data backfill; G25 WS16 archive migration first, then WS17 Card admission trigger. Existing active Cards remain valid; archived historical Cards remain valid.
- `validation`: source/route/analytics tests and TS/TSX/import scan green; actual 390px/mobile/full-HD/ultrawide, Qt, accessibility, keyboard and concurrent PostgreSQL screenshots/measurements **not yet run**.
- `exceptions`: No global chat or new UI primitives. G25 runtime acceptance deferred to certification roadmap.
