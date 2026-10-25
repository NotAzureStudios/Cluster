# Project Intelligence Overhaul

Cluster v0.386.0 is Core Product & Architecture Roadmap Step 5 of 7. It combines Search v2, project workspace unification, Builds/QA delivery intelligence, and durable workflow automation.

## Search v2

The command search corpus now indexes project control records and project workflow records as first-class `control`, `build`, `qa`, and `release` result kinds. Results remain permission-filtered through the existing project authorization boundary. Selecting a project workflow result hands navigation to the matching project workspace instead of dropping the user on a generic project overview.

Saved/recent search state remains server-backed. Search continues to use bounded indexing, fuzzy ranking, scopes, filters, and short-lived result caches rather than introducing a separate external search service before the workload justifies one.

## Project Intelligence

`GET /api/projects/:projectId/intelligence` returns a server-derived snapshot for a project the caller may view. It aggregates project control records, Builds, QA plans/sessions, Releases, boards, whiteboards, library/files, timeline posture, and open board work.

The snapshot computes:

- delivery stage and readiness score;
- blocker posture;
- release-ready Build count;
- unlinked Build and QA records;
- unified workspace counts;
- a Build → QA → Release traceability graph.

Explicit artifact IDs are preferred for traceability. Stable build/version/commit identifiers are used only as a compatibility fallback.

## Durable workflow automation

Studio Automation no longer owns a second pseudo-job system in `ClusterPersistenceRecord`. Every automation action, including zero-delay actions, is dispatched through the durable PostgreSQL background-job queue introduced in v0.384.0.

This gives automation actions the same lease, retry/backoff, cancellation, dead-letter, attempt-history, and operator visibility semantics as other durable work. Active legacy `studioAutomationJob` records are migrated to `automation.studio-action` jobs on startup and archived only after durable enqueue succeeds.

## Server-owned Build and QA events

Project workflow writes derive automation transitions on the server:

- Build failure → `build_failed`
- Build approval/pass → `build_completed`
- QA fail/block/no-go → `qa_failed`
- QA pass/go → `qa_passed`

The transition is emitted only when the workflow state crosses the relevant boundary. Event IDs bind the project workflow kind, entity, revision, and trigger so the existing automation event receipt provides idempotency.

This avoids renderer-only automation behavior and keeps Web, Desktop, offline mutation replay, and future API clients consistent.

## Security and authorization

Project Intelligence does not bypass project authorization. Search and intelligence results expose only records visible to the current user. Automation job types remain registered server-side; there is no generic endpoint that accepts arbitrary job handlers or executable payloads.

## Contract

v0.386.0 advances the API contract to `2026-08-02.27` and advertises:

- `search-v2`
- `project-intelligence-v1`
- `build-qa-traceability-v1`
- `workflow-automation-v2`
