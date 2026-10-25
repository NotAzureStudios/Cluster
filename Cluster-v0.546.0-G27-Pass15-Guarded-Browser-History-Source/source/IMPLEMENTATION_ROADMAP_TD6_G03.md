# Cluster TD6 G03 — Library authoring / Packet recipient distribution convergence

**Parent:** G02 grouped Inventory/Access source archive. **Canonical after this pass:** G03. **Development direction:** grouped feature implementation first, TD7 cleanup and full runtime acceptance afterward.

## Delivered as one connected workflow

| Layer | G03 implementation | What it does *not* claim |
|---|---|---|
| Packet audience / Library authority | `/api/packets` now emits explicit `canAuthor`, requiring both Packet edit authority and Library edit visibility for the Packet source. It suppresses underlying Library source counts in recipient projections. | Audience membership does not grant source file ACLs. |
| Recipient UI | Packet reader no longer fetches or displays underlying Library source records for recipients without authoring rights. Published, integrity-checked release catalogues and derivative downloads remain available; read/acknowledge/form completion remains available. | Does not make original Library notes automatically public. |
| Author UI | Authors retain source browsing, resource management, optional publication watermark, versioned publication, and the existing media adapters. | Does not expand PDF/audio/video conversion beyond existing verified formats. |
| Delivery evidence | New `PacketDeliveryReceipt` Prisma model and migration, independent issuance row for each authorized individual derivative or ZIP. Receipt records recipient, release, position/type, detached content hash/size, timestamp. Receipt write is required before bytes leave the delivery route. | A response from Cluster is not proof the remote browser finished receiving, saved, or viewed the bytes. |
| Evidence reporting | New scoped, paginated `GET /api/packets/:packetId/releases/:releaseId/delivery-evidence` with Packet edit and Library edit requirements; revoked versions retain historical evidence. Author-facing admin panel provides recipient names, format/position, time and bounded pagination. | Does not expose Library source paths, source IDs, secret attachments, or raw frozen manifest to recipients. |
| Tests | Executable mocked Fastify route handlers for issuance, ZIP, audit-write failure, revoked/denied access, integrity, report scope, paging, revocation history, Packet list author/recipient projection; inherited Packet and Library suites. | Not live PostgreSQL, multi-user browser, or Windows/Qt certification. |

## Canonical invariants

1. `Packet recipient` is **not** `Library source viewer`. Only source editors use Library workspace browsing inside Packets. The existing Library ACL server still owns raw file and version access.
2. `Packet source → immutable manifest → detached derivative → frozen-audience authorization → issuance receipt → HTTP response` is the delivery boundary.
3. Recipient catalogue cannot expose original Library source identity, checksums, file paths, unpublished revisions, or direct source URLs.
4. Receipt is stored before streaming/sending. If it fails, the bytes are not returned. A failed Activity projection after receipt is secondary and must not erase authoritative issuance.
5. Revocation prevents new current deliveries; old issuance evidence survives. Unsafe physical Library deletion, storage quarantine and automatic provider cleanup remain disabled.
6. Source authoring remains intact for qualified editors: version compare/restore, bulk jobs, Collections, retention, governance and file/media previews already exist and are preserved. Do **not** rebuild these systems because they appear in the ledger.

## Still unfinished (explicitly not marked complete)

- Recipient-specific watermarking beyond the existing publication watermark; secure PDF/video conversion/codec workers and full video publishing.
- Large-scale Library management enhancements still in the ledger, richer release/version authoring, exports of evidence, complete distribution acknowledgements and separately verified receipt/consume callbacks.
- Attested delivery to a specific device or end-to-end client receipt; today's evidence is **issued bytes**, not confirmed save/open.
- Remaining G04 (Projects/Boards/Whiteboards/Builds/QA), G05 (native Package installation/Desktop), G06 (Admin/Calendar/Communications/OOBE), G07 (cross-tool UX/ledger closeout) plus all CD-01–CD-20 outstanding requirements.
- Database migration execution on live PostgreSQL, full dependency-backed compile, browser/multi-user tests and Windows/Qt certification are deferred by user directive.

**Next grouped batch:** G04 Projects + Boards + Whiteboards + Builds + QA. Audit actual implementation, then complete connected workflows rather than producing serial small passes.
