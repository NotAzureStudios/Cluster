# Cluster implementation roadmap | active summary | revision 23

**Baseline:** v0.546.0 TD3 Pass 27. The comprehensive historical/source ledger is `TECH_DEBT_MASTER_ROADMAP.md`. This file is the shorter, current execution view. All release acceptance lives in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

## Phase execution

| Phase | Implementation status | Exit scope |
| --- | --- | --- |
| TD0 | Core complete | Fix new confirmed defects only |
| TD1 | Closed | Settings Authority source contracts preserved |
| TD2 | Core closed | Six configurable tools and registered job/event ownership preserved |
| TD3 | Advanced, remaining source work | Action-owner inventory, demonstrated CSS conflict cleanup, feasible Qt source parity |
| TD4 | Partly built | Real resource/action/search adapters, provider lifecycles and typed events |
| TD5 | Partly built | Missing native/diagnostic/background **implementation**, not runtime proof |
| TD6 | Major unfinished code workload | Required CD-01 to CD-20 workflows, with optional provider extensions deferred explicitly |
| TD7 | Not started | Delete obsolete implementations after canonical replacements; code freeze |

## TD6 implementation backlog (not certification)

| Work group | CD owners | Next substantive code slice |
| --- | --- | --- |
| Workflow authoring and collaboration | 01, 03, 18 | Forms respondent drafts; collaboration-safe Board/Whiteboard history; type-aware QA/build context |
| Library, files and delivery | 02, 07, 13 | Collection sharing; server-side bulk selection; missing permitted media derivatives; unified transfer operations |
| People and permissions | 04, 06, 17 | Timed access delegation, identity lifecycle, safe Vault scopes, Access Explorer |
| Packages and integrations | 05, 08, 09 | Native managed Package apply/rollback authority, entitlement reconciliation, required Git/UE/Discord integration code; vendor/provider extras may be deferred |
| Project and schedule | 10, 11 | External-safe identity and closeout, Calendar layer/recurrence integration |
| Shared studio UX and communications | 12, 14, 16, 19 | Shared commands and navigation, notification grouping/preferences, actionable error/empty states |
| Setup, operations and governance | 15, 20 | Safe config import/diff, setup recovery, cross-domain archive and privacy boundaries |

**CD-21 is NOT in this table.** Live target build, device, performance, external provider and production acceptance tests belong only to the separate release-certification roadmap. Some existing CD prose still carries historical runtime acceptance examples; those examples are not implementation gates.

## Quick-pass execution discipline

- Every pass: one related slice, concrete code, focused development checks, exact source handoff and changelog. No pass just to shuffle labels.
- Do not repeatedly certify already closed TD1/TD2 source contracts. Inherited regressions are a safety net, not a reopen request.
- Preserve distinctive visual identity: floating shell options, Project Tabs search replacement, taskbar utilities, People avatar accents/presence and layered texture.
- No percentage-complete theater. A CD item is complete only after its required user journey exists in both server and UI, or an optional feature is explicitly scoped out.
