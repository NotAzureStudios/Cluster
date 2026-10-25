# G25 WS16 continuation / source closeout handoff

**Canonical source:** `Cluster-v0.546.0-TD6-G25-Workstream16-List-Lifecycle-Ticket-Authority-Source.zip` (full source). **Parent:** G25 WS15 full source. **G25 stays source-open pending closeout audit**; do not switch to G26 without explicit remaining-state reconciliation.

## New authoritative changes

- BoardList archived Boolean/migration, serializable archive and restore with revision CAS, an independent archived-lists recovery endpoint. Active Cards/Tickets stop archiving; archived Card identity/history retained. Permanent List delete refuses any Card or history, and Board delete refuses historical Card evidence.
- Project/Ticket/Discord/Board/Card destinations no longer accept archived Lists. UI Archive/Restore and archived Card recovery paths are explicitly guarded.
- Admin ticket resolution/archival and Search use Ticket stage. Project Control follow-up Tickets require selected Board and List; three connected Project UIs share a compact selector. No auto-provisioned Boards/Lists.
- Focused checks under `cluster:td6:g25:ws16` and appended to full `cluster:td6:g25`. See detailed verification and UX record.

## Still genuinely open

- Live PostgreSQL migration, generated Prisma client/build, row-admission under simultaneous Card creation vs List archive, Board archival linked-entity behavior, real multiuser Sync/Web Locks fallback and revocations, rendering/accessibility, Qt and native Windows. These are **deferred runtime gates or specific source audit topics**, not green checkboxes from source-only tests.
- G25 source acceptance matrix and final Project/QA/Review provenance audit still require a binary decision; if source contracts are complete, close G25 *source only* with these runtime gates clearly deferred, then move to the large G26 Library/Packet/Transfer/Package batch. Do not create another micro-workstream merely for document headings.
- TD5 source-closed; no production instance/legacy migrations; physical storage destruction safeguards unchanged.
