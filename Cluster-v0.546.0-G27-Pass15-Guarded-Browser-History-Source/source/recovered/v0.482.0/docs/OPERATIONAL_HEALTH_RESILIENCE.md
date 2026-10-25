# Operational health and runtime resilience

Cluster v0.360 makes runtime health an explicit production boundary instead of a collection of unrelated diagnostic counters.

## Probe model

`/health/live` is a lightweight process-liveness endpoint. It does not touch PostgreSQL or writable storage and is suitable for determining whether the process/event loop can answer HTTP.

`/health/ready` is the traffic-readiness endpoint. A server is ready only after startup has completed, the server is not draining, PostgreSQL answers the bounded readiness probe, and critical Cluster storage can successfully create and remove a private sentinel file. The storage probe is cached for a short window so health polling cannot become disk-I/O abuse.

The legacy `/health` endpoint remains lightweight and exposes the current summarized operational state for Cluster hosts.

## Operational state

The server derives one of five states: `starting`, `healthy`, `degraded`, `unavailable`, or `draining`. Database/storage failures make the server unavailable for new traffic. Sustained background-task failures, elevated event-loop delay, request error rate, and heap pressure degrade the operational state and are visible to administrators without exposing secrets publicly.

The server records a bounded in-memory history of operational state transitions. This is incident context, not a replacement for external durable monitoring.

## Startup and background jobs

Database bootstrap, schema verification, data-folder preparation, database readiness, and writable-storage readiness complete before Cluster starts background automation. A process that is listening but cannot satisfy the dependency probes fails startup rather than advertising itself as ready.

## Draining

SIGINT, SIGTERM, and the managed-host shutdown path move Cluster into draining state before close. New application API work is rejected with HTTP 503, `Retry-After`, `Connection: close`, and the `X-Cluster-Server-State` response signal while Fastify drains existing connections within the configured shutdown deadline.

## Administrator diagnostics

`/api/admin/operations/health` combines dependency probes, runtime telemetry, PostgreSQL diagnostics, and background-task state. `/api/admin/operations/incidents` exposes only the bounded state-transition history. Diagnostic bundles include the same operational snapshot and remain sanitized/no-store.

## Non-goals

This boundary does not replace Prometheus, OpenTelemetry, centralized logs, host metrics, alert routing, or an external uptime service. Production operators should monitor liveness/readiness externally and alert on repeated readiness failures, degraded state, database pressure, backup failures, disk capacity, and host resource exhaustion.
