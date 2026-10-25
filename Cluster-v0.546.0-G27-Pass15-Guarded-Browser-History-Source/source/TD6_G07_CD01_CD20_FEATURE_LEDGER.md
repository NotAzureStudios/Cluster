# TD6 G07 — CD-01–CD-20 implementation reconciliation

**Baseline:** Cluster v0.546.0 TD6 G06. **Updated:** October 18, 2026. **Purpose:** prevent scoped source improvements from being mistaken for completed end-to-end modules. The inherited master owner matrix in `TECH_DEBT_MASTER_ROADMAP.md` (CD-01–CD-20) remains the requirements ledger. This file reconciles it with F01–F11 and G01–G07 source changes.

**Evidence terminology:** `source-partial` = concrete code/UI/tests exist but the CD category has outstanding required capabilities. `runtime-deferred` = no claim of full Node24/PostgreSQL/Qt/Windows acceptance. No CD-01–CD-20 item below is labelled fully certified. A group checkpoint proves its scoped slice, not completion of the entire CD row. Optional third-party/provider extensions require explicit 1.0 scope decisions; they are not silently marked complete.

| ID | Area | Source implementation evidence as of G07 | Remaining implementation / explicit gap | Disposition |
|---|---|---|---|---|
| CD-01 | Forms | F01 conditional branching and server-visible-answer projection; F02 deadlines, durable reminders, admin reports; prior respondent drafts | Per-user assignment contract (audience-visible is not individually assigned), fuller review UX and advanced authoring | source-partial |
| CD-02 | Library | TD4 bulk/collections/revisions/ownership inspection; G03 author-versus-recipient separation and Packet receipts | Broader explorer QoL, safe additional file operations and provider-governed disposal (unsafe physical deletion remains disabled) | source-partial |
| CD-03 | Work collaboration | F03 Card saved history; F04 sequenced Whiteboard saved history and conflict guards | Collaborative comments/reviews, broader operation classes, shared cross-resource undo and conflict visualization | source-partial |
| CD-04 | People lifecycle | F08 governed return; F09 account expiry and peer-reviewed renewal; F10 Project scoped grants; G01–G02 access/custody reconciliation | Remaining onboarding/delegation/offboarding transitions and cross-authority lifecycle UX | source-partial |
| CD-05 | Inventory/licensing | F11 Package entitlements; G01 expiring seats/key assignments and custody; G02 reviewed seat/key issuance and reconciliation | Supplier/contracts, advanced seat reassignment and team policy; provider redemption integrations are separate scope | source-partial |
| CD-06 | Vault | Existing controlled secret reveal/revoke/rotate and Inventory key concealment preserved | Delegated scoped secret-use roles, rotation automation and secret-use evidence | source-partial |
| CD-07 | Packets/distribution | F05 bounded WAV derivative; existing text/PDF/image delivery; G03 immutable delivery issuance and source/recipient isolation | Video and broader audio formats, watermarking and per-recipient derivative policy | source-partial |
| CD-08 | Packages/Desktop | F06 update conflict plan; F07 destination integrity audit; F11 entitlements; G05 signed dependencies and native prerequisites | **Supervised OS installers**, elevation, uninstall, trusted installation state, cross-package atomic rollback | source-partial; critical |
| CD-09 | Git/Unreal/Discord | Native Git / LFS and Discord integration contracts preexist; G05 package signing native verifier | Required integration code gaps need explicit source review; live external proofs deferred, not falsely implemented | source-partial; verify scope |
| CD-10 | Projects 2.0 | Project tools already broad; G04 release gate convergence, QA/reviewer/provenance blockers | Project workflows/identity/external-safe naming/readiness end-to-end owner audit | source-partial |
| CD-11 | Calendar/Scheduler | Canonical visibility/events; G06 durable **owner-only** non-recurring reminders | Attendee-safe permissions, occurrence-based recurrence, overlays, DST/availability behavior | source-partial |
| CD-12 | Shell/appearance | TD3 shared UI/Qt source closeout; floating/taskbar and responsive shell preserved | Real legacy tool coverage, accessibility parity and native Qt source-level integration as needed | source-partial; acceptance deferred |
| CD-13 | Transfer Center | Existing resumable transfers, taskbar, native services and managed file paths | End-to-end source proof for durable pause/resume/cancel and cross-window error states | source-partial |
| CD-14 | Shared navigation/search/actions | TD4 canonical search/action/pickers; G07 adds **Copy ID** in work menus and Command Palette | Copy Path for supported actual filesystem paths, middle/Ctrl-click, per-tool action coverage, recent/favorites polish | source-partial |
| CD-15 | Setup/config/recovery | Guided config/set-up and `.clusterconfig` safety work inherited from 0.506 source | Broader safe import diff, OOBE checklist, disaster recovery, configurable defaults and inheritance explanations | source-partial |
| CD-16 | Notifications/communications | F02/F09/F11 notifications; G06 scheduled publication/durable outbox; G07 content editing, audience preview and clone-to-draft | Per-tool preferences, quiet-hours, additional delivery channels, attendee audience controls and templates | source-partial |
| CD-17 | Admin/Operations | Operations monitoring, approvals, settings and access views; G02 People access reconciliation and G06 announcement counts | Comprehensive operator diagnostics, actionable tool resource usage and Admin Inspector | source-partial |
| CD-18 | Builds/QA | Project Build/QA workflows, G04 shared release publication blockers and revision-pinned sign-off | Remaining production-type workflows, branch map, cross-tool QA triage coverage | source-partial |
| CD-19 | Interaction quality | Shared Create double-click intent, Search drawer, save history and primitive controls; G07 editable/cloneable announcements and audience preview | App-wide draft/saving/undo indicators, contextual Help, permission denied reasons and micro-behavior adoption | source-partial |
| CD-20 | Data/privacy/backup/retention | Existing permission/privacy, audit, Library governance and Packet source separation; G03 receipts | Broader backup/recovery/retention matrix, legal hold across all tools, controlled storage destruction remains disabled | source-partial; safety gate |

## Next *grouped* source batches, not micro-passes

1. **G08 — Calendar / communications / admin completion:** implement participant-safe reminders only through canonical per-recipient authorization, then recurrence/occurrence dedupe, announcement templates/approval policies and admin preview UX. Never infer access from attendance alone.
2. **G09 — Onboarding / OOBE / settings + Help:** setup checklist and configuration diff/impact UX, permission explanations, reusable guidance for workflows. Preserve Studio vs Server vs Tool config ownership.
3. **G10 — Library / media / Packets + transfers:** complete additional safe derivative formats and watermark provenance, transferable resource UX; keep unsafe physical unlink/quarantine disabled.
4. **G11 — Desktop / native install + cross-tool completeness:** supervised installer contract, rollback/state evidence, remaining CD-03/CD-08/CD-09/CD-13 integration owners, source-level hardening.
5. **Then targeted closure batches** for any CD rows still lacking backend/UI/connected flow, followed by TD7 cleanup and release certification. The numbers are ordering aids, not artificial limits.

## G07 implementation evidence

- `packages/shared/src/studio-systems-contracts.ts`: strict draft-edit and audience-preview contracts.
- `apps/server/src/domains/studio-systems/studio-workflow-routes.ts`: admin-only live audience preview (count only; strict failure), optimistic-concurrency draft/scheduled content edits; publication-imminent and published records cannot be edited.
- `packages/renderer/src/features/settings/StudioAnnouncementsPanel.tsx`: edit/preview/duplicate UX, save status and busy protection while preserving schedule, cancellation and Inbox report.
- `packages/shared/src/workflow-contracts.ts`, `packages/renderer/src/features/workflow/{work-actions,WorkActionMenu}.ts*`, `packages/renderer/src/features/search/CommandPalette.tsx`: consistent canonical Copy ID action in search and work menus.
- `tools/scripts/cluster-td6-g07-cross-tool-ux-tests.mjs`: executable route and feature wiring checks, including negative access paths.

**Important:** The current 1.0 source is not ready to freeze. `source-partial` does not mean a regression failure; it means a requirement owner still needs implementation evidence. Environment certification is tracked separately in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` and intentionally deferred.

## G08 additive implementation note

CD-11: Calendar adds permission-checked attendee/owner reminders, per-occurrence durable dispatch and bounded daily/weekly/weekday/monthly recurrence. Admin summary is aggregate only. Recurring calendar UI, edits/exceptions, per-user preferences and time-zone editor remain open. CD-16: Calendar reminder outbox now delivers per authorized participant; announcements/templates/quiet hours still open. See `TD6_G08_CALENDAR_COLLABORATION_IMPLEMENTATION.md`.

## G16 additive implementation (October 19, 2026)

- **CD-08:** New signed Package releases may use SHA-256 keyed provider-backed artifacts instead of SQL bytes. A single read authority works with legacy releases; device-authorized recovery of an existing offer is bounded and revokes the previous nonce. Native Go helper supports durable disk transfer checkpoints and SHA-verified final promotion, **not yet connected to Qt**. MSI installation health, multi-GB signatures and cross-package recovery remain open.
- **CD-13:** Reuses shared `ClusterStorageRuntime` for Package byte storage, with 4 MiB chunk bounds and a read-only checkpoint primitive. Desktop/Transfer Center disk-backed resume is still incomplete; no generic Transfer Center completion claim.
- **CD-02 / CD-07:** The same underlying provider is available to Library today, but no new recipient-facing Library/Packet large-media path is claimed in G16. Preserve author/source vs derived delivery authority.
- **CD-20:** SQL CHECK enforces SQL-vs-provider authority, retained hashes and provider locators; physical GC/orphan cleanup remains disabled pending source ownership and runtime recovery proof.
- **All rows:** Still `source-partial` and `runtime-deferred`. G16 is a substantial connected storage/transfer foundation, not CD completion.

## G17 additive implementation (October 19, 2026)

- **CD-08/CD-13:** Qt native broker now bridges verified signed Package range downloads to the G16 native Go disk spool; renderer can stream bounded 4 MiB authorized HTTP responses into a persistent local SHA-bound checkpoint without constructing another full ZIP for the **archive-retention** action. A local offset can be continued with a **new** server-authorized offer. Original kit staging remains independent and in-memory; no native installation or release certification is implied.
- **CD-20:** User/profile isolation and checksum checks are enforced before promoting downloaded bytes; native archive is not a credential or an authorization grant. No cleanup/physical disposal is enabled.
- **Open:** server offer recovery after restart, direct native kit creation, streaming large signed uploads, Qt build/runtime certification and other CD items remain source-partial.
