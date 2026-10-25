# Cluster v0.505.0 RC17 WIP57 — P16C → P17 Handoff

## Checkpoint identity

- Human checkpoint: **v0.505.0 · RC17 · WIP57 · P16C**
- Machine checkpoint: **0.505.0-rc.17+work.wip57.p16c**
- Scope: **Capability Exposure Closeout**
- Artifact role: **transplant overlay**, not a replacement trusted source baseline

## Trusted baseline rule

The authoritative source lineage remains the packaged **P15** checkpoint:

- `Cluster-Master-v0.505.0-RC17-WIP57-Reconstructed-Admin-ProjectTypes-Pass15.zip`
- SHA-256: `c758d4edfa38e8bde538b89c1c200a7cf7fbd2fbe08295bc43d5d1e1b0616c1f`

The P15 package is retained in the Project/Library, but its raw bytes were not materializable in the current execution runtime. P16A–P16C were therefore developed and validated on the available P13 reconstructed source **as a staging base only**.

Do **not** promote the staging tree over P15. Transplant these changes onto P15 and preserve all P14/P15 work.

## P16A retained

- Library Lifecycle inspector surface:
  - backlink listing/navigation
  - retention policy/date
  - legal/administrative hold controls
  - destruction preview with dependency/version/backlink evidence
  - restore
  - typed-confirmation permanent destruction
- Project Access Explorer now uses `/api/access/explain` as the authoritative explanation path.
- P16A assertions: **12/12**.

## P16B retained

- Workforce availability exceptions:
  - unavailable
  - limited
  - preferred
  - time off
- Shared self/direct-manager/elevated management authorization.
- Privacy-projected reason text.
- Scheduler conflict integration plus positive preferred-availability readiness signals.
- Canonical checkpoint/artifact naming contract introduced.
- P16B assertions: **13/13**.
- Naming assertions: **8/8**.

## P16C changes

### Project workflow graph

- Exposes the existing `/api/projects/:projectId/workflow-graph` authority inside Project Control.
- Interactive focus selection.
- Incoming / outgoing / both directions.
- Depth 1–4.
- Bounded 250-edge request.
- Graph lanes and relationship evidence.
- No duplicate graph persistence authority.

### Media metadata export preview

- Adds `previewViewerExport()` using `/api/review-assets/:assetId/metadata-export-policy/preview`.
- Safe Share and Strip All preview metadata policy before derivative creation.
- Custom export previews after category selection and before derivative creation.
- Standard derivative previews require derivative-export capability.
- Custom category selection remains manage-gated.
- Sensitive metadata stays redacted unless the caller has sensitive-metadata access.

### Admin audit activity

- Adds a first-class `AdminAuditStreamPanel` using `/api/audit/activity`.
- Filters:
  - action/type
  - resource/entity type
  - exact resource/entity ID
  - Project
  - actor
  - from/to dates
- `/api/audit/activity` now actually honors its declared `entityId` filter.
- Adds server `from` / `to` filtering.
- Audit results include actor and Project context.
- Evidence/metadata remains read-only.

### Naming contract

Active checkpoint is now:

- display: `v0.505.0 · RC17 · WIP57 · P16C`
- machine: `0.505.0-rc.17+work.wip57.p16c`

New artifact pattern:

`<Product>-v<version>-<train>-<wip>-<pass>-<scope>-<role>.<ext>`

`Phase10` is retired from **new** filenames. Historical hashed artifacts remain immutable.

Historical assertion gates use `certifiedExamples`, so advancing the active checkpoint no longer breaks P16B merely because the current pass changed.

## Important P15 transplant conflicts

P15 changed the Admin navigation substantially. When transplanting:

1. **Do not overwrite P15 `AdminWorkspacePage.tsx` wholesale with the staging version.**
2. Preserve P15 canonical admin destinations:
   - Command Center
   - Incidents
   - Governance
   - Systems
   - Data & Audit
3. Insert `AdminAuditStreamPanel` into the existing **Data & Audit** surface.
4. Do not reintroduce the old Reports/Operations Center/Approvals peer navigation from the P13 staging tree.
5. Append the P16C audit CSS to the P15 admin stylesheet without restoring removed P13 navigation CSS.
6. Preserve P15 Studio Settings, Server Configuration, Tool Infrastructure, Project Type, and specialized-production-profile work.

P14 Library/Media/Projects work must also remain intact while merging P16 Library/Viewer changes.

## Validation completed on staging

- Full `npm run verify:source-foundation`: **PASS** through P16C.
- P16A: **12/12**.
- P16B: **13/13**.
- P16C: **15/15**.
- Naming: **8/8**.
- **921 TS/TSX**, 0 syntax diagnostics.
- **498 renderer TS/TSX**, 0 unresolved relative imports.
- **107 CSS**, 0 delimiter errors.
- `git diff --check`: clean.
- Prisma remains **89 migrations**.
- No native rebuild claimed.
- No Windows/runtime certification claimed.

## Required validation after P15 transplant

1. Resolve all conflicts by preserving P14/P15 authorities first.
2. Run naming, P16A, P16B, and P16C assertions.
3. Run full `verify:source-foundation`.
4. Re-run TS/TSX syntax diagnostics, renderer relative-import check, and CSS delimiter check.
5. Compare normalized semantic diagnostics against untouched P15.
6. Verify Prisma stays at 89 migrations unless an intentional schema change is introduced.
7. Regenerate source manifest and release metadata from the merged P15 tree.
8. Package only after manifest verification, ZIP integrity, and SHA-256 agree with canonical checkpoint metadata.

## P17 next

P17 is **Runtime Certification / Evidence-Driven Closeout**:

- fresh PostgreSQL bootstrap through all 89 migrations
- OOBE/setup/login/restart/recovery
- Windows process-tree shutdown cleanup
- 100% / 125% / 150% DPI
- Library lifecycle/viewer/transfers
- Project closeout/workflow graph
- Calendar/People availability/privacy
- multiple users/tabs/permissions
- idle request counts, SSE reconnects, sync leadership, notification reconciliation, transfer reconciliation, and background-task/log evidence

Runtime discoveries get the smallest authoritative fix plus regression coverage. Do not reopen speculative architecture during P17.
