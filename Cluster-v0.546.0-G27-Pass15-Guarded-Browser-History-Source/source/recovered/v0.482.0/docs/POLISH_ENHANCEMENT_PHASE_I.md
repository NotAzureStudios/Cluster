# Phase I — Server + Admin Experience

Phase I turns Operations into an actionable server control surface instead of a collection of unrelated diagnostics.

## Server Operations Center

The admin overview now combines runtime readiness, PostgreSQL pressure, storage, durable/background jobs, realtime/domain-event state, backup posture, security posture, log/audit footprint, and release version context. Detailed performance, jobs, integrations, and activity panels remain available for drill-down.

## Remediation-first administration

The overview derives bounded recommended actions from failing runtime checks, missing storage, security configuration gaps, failed/dead-letter jobs, backup policy state, and integration setup. Actions route administrators to the existing Server Configuration, Tool Infrastructure, or Studio Settings surfaces rather than duplicating configuration controls.

## Boundaries

All operational endpoints remain admin-only and read-only unless an existing explicit administrative action is invoked. Secrets are not returned by provider or diagnostic summaries. Database URLs remain redacted, and diagnostics exports retain the existing redaction boundary.
