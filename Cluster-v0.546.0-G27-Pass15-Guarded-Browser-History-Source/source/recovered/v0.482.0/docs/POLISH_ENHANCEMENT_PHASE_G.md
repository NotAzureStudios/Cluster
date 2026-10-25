# Phase G: Scheduler + Time

Phase G treats Scheduler and time tracking as one planning system rather than separate clock and calendar utilities.

## Product contract

- The Scheduler workspace surfaces capacity, planned workload, unavailable time, nearby project milestones, and schedule conflicts beside tracked time.
- Schedule overlap detection distinguishes normal overlapping work from high-severity availability/time-off conflicts.
- Scheduler managers may drag existing schedule blocks between days; the server remains authoritative and recalculates conflicts after the move.
- The schedule API supports bounded recurring daily or weekly blocks for managers, with two to twelve occurrences.
- Time-off continues through the existing approval workflow and cannot silently become a self-approved schedule block.
- Time entries remain project/board/card linkable.
- Billability remains administrator-controlled through Scheduler settings rather than a normal-user choice.
- Existing break, correction, lock, exception, capacity, and project allocation behavior remains intact.

## Security and data boundaries

Recurring and rescheduling operations still pass through the existing authorization and project-reference checks. Non-managers cannot create arbitrary recurring schedule blocks or move blocks. Time-off requests preserve the existing approval boundary.
