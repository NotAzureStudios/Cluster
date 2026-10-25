# Cluster TD5 closeout / TD6 G21 → G22 handoff

**Authoritative source:** `Cluster-v0.546.0-TD5-Closeout-TD6-G21-Occurrence-Responses-Source.zip`. Use the entire source, migration, tests and manifest. G20 is its parent, not a competing branch.

**TD5:** Source closed by explicit implementation/certification split. `npm run techdebt:td5:source-closeout` passes 14/14 scripts (167 cases). P12 inherited test drift fixed without changing production semantics. Real Node24/PostgreSQL/Qt/Win32 and storage recovery are **not certified**; unsafe physical deletion/GC/tier migration remain disabled. See `TD5_SOURCE_IMPLEMENTATION_CLOSEOUT.md`.

**G21:** Normalized per-occurrence meeting RSVP/attendance rows and per-row CAS revisions; original anchored UTC key, strict participant/manager permissions and skipped occurrence checks; UI editing; bounded response query; occurrence-specific reminders; audit; SQL migration. `npm run cluster:td6:g21` includes 13 new G21 checks and inherited G20/G08/G06 regressions.

**Next grouped TD6 priority:** CD-03 Project/Board/Whiteboard collaboration and shared comments/history (cross-resource permissions and audit) **or** finish CD-11 detached occurrence moves using Scheduler-aware booking (not an API-only move that leaves ghost reservations). Continue grouped feature delivery through CD-01–CD-20, TD7 after feature implementation, certification last. Do not call TD6/Calendar or v1.0 feature-complete.

**Known boundaries:** Schema migration unexecuted on live PostgreSQL, no dependency-backed compiler build, and native executables unchanged. Calendar recurrence limited to G20's anchored supported rules; per-occurrence response overrides do not move physical Scheduler reservations. Response reset/rebase is not yet exposed, so series timing edits intentionally fail closed when occurrence responses exist.
