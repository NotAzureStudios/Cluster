# Phase 6 Workflow Integration

Cluster v0.408 extends the production E2E harness across Phase 6.8-6.16. It uses the isolated PostgreSQL schema, built server/web artifacts, and independent Playwright browser contexts established by the Phase 6 foundation.

The harness now creates a Timeline item, propagates two-client collaboration state, and proves optimistic concurrency by requiring a stale revision to return HTTP 409. It exercises the durable Notifications inbox, creates and reads a project-bound Scheduler block, creates a Ticket on the provisioned Board, writes revisioned Build and QA workflow records, reads the admin Approval queue, and uploads then downloads a bounded binary Library asset byte-for-byte.

The large-file scenario defaults to 2 MiB and can be raised with `CLUSTER_E2E_LARGE_FILE_BYTES`, capped at 16 MiB for CI safety. Live execution still requires a real PostgreSQL test database, built Server/Web output, Playwright, and Chromium. Source/audit validation does not claim those runtime scenarios were executed when those dependencies are unavailable.
