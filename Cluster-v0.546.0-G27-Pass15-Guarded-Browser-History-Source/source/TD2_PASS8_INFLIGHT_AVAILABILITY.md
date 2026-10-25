# TD2 Pass 8 — In-flight Tool Availability Checkpoints

**Parent:** TD2 Pass 7 authoritative pre-handler execution gate (`Cluster-v0.546.0-TD2-Pass7-Authoritative-Execution-Gate-Source.zip`). No new runtime framework or database migration.

## Defect class

An enrolled Calendar/Library durable job is checked against current Studio Settings before beginning, but a remote administrator can disable a tool while a long-running Library job is already executing. Checking only at handler entry lets subsequent independent derivative operations continue despite the disable. Killing a Library transfer during a storage move or partial DB publish, however, is not safe.

## Implemented

1. Added `throwIfToolUnavailable()` to the existing `BackgroundJobHandlerContext`. It checks cancellation/lease loss, the process-local owner switch, and the **fresh authoritative** Settings-backed availability gate. A disabled owner raises `BackgroundJobDeferredError`, which uses the existing leased, retry-preserving queue deferral path.
2. Library derivative generation checks at handler entry, before each separate derivative unit, and immediately before publishing each derivative record. Completed earlier units are safe to rebuild on retry via the existing deterministic derivative identity/upsert.
3. Library transfer-finalization checks before optional setup and **before entering the irreversible file-store/publish phase**. It intentionally does not pause between the file move, Library item publication and completion/derivative scheduling. Interrupting this region can strand a partially committed upload.
4. Derivative failure handling no longer mislabels tool-availability deferrals or signal-based worker interruption as a failed derivative row.
5. Added eight runtime-harness assertions to test cross-process stale-local state, repeated safe boundaries, cancellation precedence, explicit Library handler enrollment, and unowned maintenance.

## Limitations and certification debt

- Checkpoints are cooperative and are **not atomic distributed fencing**: a disable can race the final boundary check. No guarantee is made that an already-committing transaction can be interrupted or rolled back.
- Long media decoding/FFmpeg processing may continue until the next safe checkpoint. To stop CPU promptly mid-encode, derivative processing needs a separately designed abort-and-cleanup contract, including temp-file atomic publish and retry behavior.
- Calendar trigger evaluation has no mid-evaluation checkpoint yet; its pre-handler availability guard remains intact.
- Real PostgreSQL multi-process tests, race/lease expiry tests against the actual DB, long-running Library storage tests, Node 24 dependency-backed build, Windows runtime checks and measured idle CPU/network evidence are still pending.
- Shared retention, backup, security and notification work remains intentionally independent of optional tool enablement.

**Next:** Live PostgreSQL two-process disable/transfer/derivative tests and service ownership audit, then close out TD1/TD2 evidence gaps instead of adding new framework surfaces.
