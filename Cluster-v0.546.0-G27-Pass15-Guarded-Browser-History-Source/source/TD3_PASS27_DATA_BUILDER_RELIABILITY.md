# Cluster v0.546.0 — TD3 Pass 27: shared data builders and roadmap revision 23

**Parent:** TD3 Pass 26 complete development-source checkpoint. **Scope:** source implementation, with target-environment certification separate.

## New source behavior

- Shared `DataExportBuilder` now uses the existing immediate `useClusterActionFlight` gate. Submitting a second export before the pending state renders is rejected; field/edit/close actions cannot alter the request while running. Async exporter rejection displays inline `role="alert"` feedback rather than becoming an unhandled Promise. On confirmed completion the panel closes. Existing field sensitivity, scope, CSV/JSON/XLSX and Library-delivery choices are retained.
- `DataImportBuilder` now gates validate, queued Apply, and workbook selection through the same single-flight primitive. It keeps controls fixed while a mutation is running and preserves staged change-set approval semantics.
- File parse, worksheet parse, import schema and server preview responses use the existing generation-owner primitive. When files/mappings/policies change or the component unmounts, obsolete work cannot overwrite later selections or resurrect stale staged previews.
- Existing import jobs, server stage/fingerprint protections and operation progress feedback remain authoritative. No new API, mutation contract or database migration was introduced.

## Roadmap reconciliation

`TECH_DEBT_MASTER_ROADMAP.md` revision 23 defines active implementation phases and stops using production acceptance as development closeout. TD0–2 core is closed; TD3 remains open for demonstrated source gaps; TD4–6 remain the substantial future code work; TD7 follows canonical replacement. Active completion debt is CD-01–CD-20. CD-21 is historically retained but moved to `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` as the release gate. Native Package implementation in CD-08 and required integration code in CD-09 remain on the implementation roadmap; execution proof is separate.

## Development evidence and limitations

- Focused executable/shared-primitive and source-contract checks: **10/10 passed**.
- Inherited TD0/TD1/TD2/TD3 development scripts selected from Pass 26: **15/15 passed**.
- TypeScript/TSX syntax parsed for 1,009 application files; no syntax diagnostics. Renderer relative imports: 3,138 examined, none missing. CSS: 110 files, no delimiter errors.
- **Not a full installed-dependency typecheck or mounted React test.** External exporter callbacks may swallow their own errors; a resolved callback is the only success signal available to this shared UI. Live import/export API integration and Windows/Qt release tests remain on the separate certification roadmap.

## Preservation and next pass

Preserve the floating/docked shell modes, animated search replacing only Project Tabs, My Work, Tickets, Transfer Center, People personal accent borders and independent presence dots. Finish remaining shared UI source gaps, then start TD4 adapters and TD6 required workflows without creating an artificial release-test gate.
