# Next 1.0 milestone after F4 P3

Authoritative source: `Cluster-v0.546.0-F4-P3-Maintenance-Mode-Control-Plane-Fence-Source.zip`.

Prioritize F4 P4: reconcile actual startup/boot-time mode with live mode visibility, controlled transitions, on-call schedules and maintenance windows. One authoritative status source, no duplicate settings engine. Add admin PIN, revision-checked control operations, preflight, drain, write admission, worker checkpoint and rollback. Avoid granting privileges simply because a route is under `/api/admin`; every approved emergency action must be individually allowlisted, RBAC checked and audited. Keep native supervisor emergency transport functional while Node/PostgreSQL are down.

Preserve F2 P6 network rollout and F4 P1/P2 health cadence; new PostgreSQL migration and Windows service tests must be performed before production.
