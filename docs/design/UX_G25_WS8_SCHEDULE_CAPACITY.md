# UX-G25-008: Recurring Scheduler capacity and honest availability

change_id: UX-G25-008
problem: Scheduler availability could show an open slot despite virtual recurring commitments, or reject a resource that still had quantity available; the planner offered override during unverified availability.
current_goal: accurate, privacy-safe scheduling with a compact, legible planning surface.
historical_decisions: CL-DS-001 v1.3.0 active for truthful state; capacity-on-recurring provisional until verified in live scheduling; prior binary room-conflict logic superseded.
source_evidence: scheduler-calendar-availability.ts; cluster-td6-g25-virtual-scheduler-capacity-tests.mjs.
reused_components: SchedulePlanningDialog, ClusterModal, ClusterButton, existing Schedule Resource quantity/read model and Calendar projection.
proposed_behavior: display count-based booking pressure, separate known conflict from incomplete capacity check, remove Place anyway for incomplete, disable commit until user adjusts/rechecks, preserve draft values.
states: available / occupied with quantity / unverified / save pending / failed (no commit).
security: show redacted conflict information; no other private meeting details from virtual projection; server blocks incomplete override.
migration: none; existing meeting/exception/room records and project permissions retained.
validation: 24 focused source tests; main G25 regression, TD5; pending browser multiuser, narrow/ultrawide and Windows DPI, access-revocation and live PostgreSQL capacity race.
exception: indefinite recurring series future occupancy cannot be certified across unlimited time; requires later explicit finite planning-horizon policy.
