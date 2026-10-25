# F4 P15 → 1.0 implementation handoff

Current cumulative source: `Cluster-v0.546.0-F4-P15-Verified-Update-Recovery-Preflight-Source.zip`.

The maintenance window and update recovery preflight now produce genuinely bounded, fail-closed policy evidence, while retaining the `executable:false` API contract. Implement the **native-owned** maintenance executor next; do not rely on a JS process alone to restart itself or assume DB-backed policy is available when PostgreSQL is offline. Run native Windows 10/LocalService/Job Object acceptance, Node24, PostgreSQL 18 live migration/restore drill, Garnet .NET/Lua/PubSub tests. Complete the CD01-CD20 ledger, TD7 fossil cleanup, installer/signature validation and soak before 1.0.
