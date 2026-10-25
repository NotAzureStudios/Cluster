# F4 P2: Live Operations Schedule Rearm

Exact parent: `Cluster-v0.546.0-F4-P1-Configurable-Operations-Cadence-Source.zip`.

Adds `BackgroundTaskRegistry.rescheduleAdaptive(name,nextDelayMs)` to rearm ONE already registered adaptive timer without creating a new registration or interrupting an in-flight callback. Only finite, safe-integer intervals 60 seconds to 24 hours are accepted. Stopped/suspended/missing or running jobs are not rearmed. An active job reads the saved cadence before scheduling its next run. A failed registration never silently spawns duplicate timers.

Cluster connects this to the existing committed-settings coordination and local periodic DB fallback, comparing effective interval values against a startup snapshot so unrelated settings updates do not reset running error backoff. A cross-process change is reread from the database; no secret settings are sent on coordination bus. Local protected Server Config saves reuse the existing one-PIN and revision checks.

Verification: focused behavior tests on the actual transpiled background task class, selected inherited F4 P1/F2/F3/API regressions, TypeScript/CSS/relative-import scan, source ZIP/hash and exact-parent patch verification.

Limitations: the 60-second lost-hint fallback may delay convergence when the coordination message is unavailable. An active job is never aborted to change cadence. Jitter/pressure/load can defer actual checks. No Windows 10 live service test, no Go native change, no database migration, no automatic restart/update/restore approval.
