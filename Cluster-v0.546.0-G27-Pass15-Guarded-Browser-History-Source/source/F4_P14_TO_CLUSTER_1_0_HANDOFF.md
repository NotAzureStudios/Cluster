# F4 P14 → Cluster 1.0 closeout handoff

Authoritative parent for future changes: `Cluster-v0.546.0-F4-P14-Maintenance-Windows-Preflight-Source.zip`.

Implemented: disabled-by-default weekly window policy, DST-aware bounded preview, one-PIN saved settings, admin API, preflight blocker outside enabled windows. **No automatic service execution is authorized.**

Next executable slice: design an authenticated, least-privilege IPC boundary between the admin control plane and native Windows Service. Obtain exclusive cross-process maintenance lease, verify chosen window against the saved policy, issue announcements/acknowledgment, drain safely (uploads/jobs/requests), and restart only after fresh readiness & recovery evidence. Fail closed if operator credentials/lease/policy cannot be independently verified. Prefer conservative manual approval for update and rollback until runtime tests prove safety.

Existing blockers: pinned Node 24 + Go 1.27.1 build; PostgreSQL 18 unapplied migrations F3 P2/P3 and F2 P4; Windows 10 SCM/Job Object/LocalService permissions including SMB; actual Garnet/.NET 10/Lua/PubSub compatibility; alerts; backups and restore drill; remaining CD-01–20 source/UX closeout; TD7/release soak/signed artifacts.
