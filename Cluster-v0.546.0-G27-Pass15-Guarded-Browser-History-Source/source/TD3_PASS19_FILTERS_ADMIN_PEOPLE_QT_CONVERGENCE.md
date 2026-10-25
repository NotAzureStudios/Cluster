# Cluster v0.546.0 | TD3 Pass 19: Filter / Admin / People / Qt convergence

**Base:** TD3 Pass 18. **Scope:** source implementation only; TD1/TD2 remain implementation-closed, release certification remains a separate future roadmap.

## Delivered implementation

- Created reusable `ClusterFilterPopover` with a single labelled trigger and canonical `ClusterFloatingSurface`. Projects **More filters** now uses that body-portaled surface rather than locally absolutely positioned native details. The source, schedule and priority selectors and current active-filter counter are retained. Shared overlay handling provides Escape/outside click, focus return, viewport-aware positioning and a phone sheet. A visible **Close filters** action is included.
- Migrated **seven Admin Operations** expandable sections (runtime work; maintenance; persistence/recovery; imports; data model; templates; changelog) to `ClusterDisclosureGroup`, preserving all detailed panel bodies and relevant section-driven initial expansion.
- Migrated **People team/expertise context** and nested **admin-only permission-bundle editor**. Studio team counts, allocations, expertise directory, interactive bundle assignments and individual profile controls remain.
- Migrated **Project Type advanced behavior** in Studio Settings to canonical disclosure while preserving editor grid and associated labels.
- Adjusted domain CSS selectors for actual shared markup rather than adding a global override. Retired Projects' duplicate inline filter positioning and native arrow; preserved domain colors and material surfaces. Added small mobile-specific grid handling.
- Native Qt primitives: `ClusterSwitch` exposes an accessible name override, CheckBox role and checked state; `ClusterButton` supports an accessible name distinct from visible text; `ClusterComboBox` explicitly advertises its role. No Qt executable was rebuilt.

## Preservation / regression guardrails

The canonical taskbar still owns Project-only tabs, animated search replacement, My Work, Tickets, Transfer Center, notifications/account. People avatars retain per-user accent border, rounded-square presentation and a separate presence indicator. Surface customization and floating/full-width preferences are unchanged. All existing Admin permission boundaries and Project filter data policies remain in their prior owners.

## Development evidence

- 20/20 inherited+new development scripts passed after updating the one stale P15 test to assert the enhanced Qt Switch accessible-name contract.
- 32/32 new P19 integration/source assertions passed.
- TypeScript, import and stylesheet lexical scans: see `TD3_PASS19_VALIDATION.json`; zero reported errors.
- 16 desktop/phone, dark/light Chromium preview fixtures show Projects, Operations, People and Studio Settings. No document horizontal overflow; taskbar utility placeholders present. **These are representative production-CSS illustrations, not 1:1 mounted React or Qt screenshots**.
- Source hash-manifest, archive integrity and incremental patch replay are package-level checks, recorded separately.

## Still implementation debt, not certification

TD3 remains open for genuine workspace-local action menu owners (especially complex inline controls) and any materially overlapping CSS / native parity defects confirmed in code. Do not migrate native `<details>` indiscriminately where raw logs/evidence are legitimately lightweight and independent. Release acceptance on Windows/React/PostgreSQL/DPI remains only in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.
