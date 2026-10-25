# Cluster implementation roadmap | revision 73

**Source baseline:** v0.546.0 TD4 R73, continued directly from R72. Historical technical-debt ledger: `TECH_DEBT_MASTER_ROADMAP.md`. Runtime certification: `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Source status | Next direction |
| --- | --- | --- |
| TD0–TD2 | Source-closed | Preserve; fix demonstrated regressions only |
| TD3 | Source-closed | Preserve UI/Qt interaction contracts |
| TD4 | **Active: R73** | Complete remaining governance adapters and finite event/provider owner matrix; preserve storage safety exclusions |
| TD5 | Partly built | Native platform integration, reliability and operational workflows |
| TD6 | Significant feature backlog | Studio/Forms, approvals and collaboration end-to-end workflow completion |
| TD7 | Not started | Canonical cleanup and source freeze after source convergence |

## Delivered in R73

1. Canonical `studio_form` and `form_submission` resource identities, Search scopes and Resource Action/navigation mappings.
2. Bounded Studio Forms and non-application submission search corpus with **whitelisted** metadata. Respondent names, email addresses, answers and personally identifiable fields are excluded from the Search index.
3. Fresh database admission of each indexed form/response with current identity, parent, revision, status and audience/config revision validation.
4. Require actual administrator + Studio Settings edit authority before Search returns a form/submission; protect both direct exact-record API routes with existing `requireAdmin`.
5. Deep links into the existing Studio Systems review interface, including exact submission lookup beyond page 1; public applications remain in their separate workflow.
6. Fix Studio Settings deep-linked section initialization and the inspector handoff.
7. New 35-assertion focused suite; inherited 51-script TD4 suite selection green; source/import/CSS checks green; no new **normalized** TypeScript semantic diagnostic signatures vs R72 under the available lean build environment.

## Remaining for TD4 source closure

- Finish real, navigable governance Action/Search adapters. Confirm individual approval decision, forms application, announcement and automation screens before adding any identity; do not index private payloads or route to unrelated generic tabs.
- Finite event consumer and producer inventory: `work.assignment.changed` has wildcard observers but no dedicated materializer/backfill policy. Avoid cosmetic registrations that cannot process historical events.
- Provider lifecycle ownership outside six TD2-configurable tools: register/drain/unregister/re-enable and revoked access negative cases with executable tests.
- Storage quarantine, migration, managed-blob GC and physical destruction are **disabled** because generation fencing, provider ownership, restore and backup certification are unproven. Preserve their safe exclusions; transfer to a separate provider-safety gate if needed, without claiming the capability exists.
- Final TD4 matrix of resource kind → authorized reader/search/action/consumer owner; finish source-level negative tests and freeze only after all implemented, excluded or explicitly transferred.

## Certification separation

Source tests do not certify dependency-backed Node 24 compilation, live PostgreSQL multiworker/migrations, authenticated multiuser/browser interaction, native Qt/Windows or real NAS/S3 crash-recovery. These remain independent release gates.
