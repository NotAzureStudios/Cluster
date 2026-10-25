# Cluster v0.546.0 · TD6 G19 | Retained Archive → Independently Verified Native Stage

**Baseline:** G18 complete source. **Status:** G19 source implementation complete; Qt/Windows runtime and release certification deferred. Version remains v0.546.0.

## Grouped implementation delivered

1. **Native Go: `transfer-stage`.** Accept a previously committed SHA-256 disk checkpoint, selected Package identity, independent signing-key pin and bounded signed sidecars. The helper rehashes actual bytes, refuses noncommitted or corrupt checkpoints, validates signed target identity, and uses the existing Ed25519 ZIP staging verifier. It does not treat a persisted deployment offer as access or an installation grant.
2. **Private sidecar handoff.** Qt transports only canonical signed manifest JSON, Ed25519 signature and informational public PEM (no archive bytes, tokens, paths, pin or privileged commands). The Go helper restricts this envelope to 8 KiB, stores temporary 0600 files in an OS-generated directory inside the private profile root and deletes them after verification. The stage cannot replace an existing staging tree.
3. **Native Qt allowlist.** Adds `package.transfer.stage` behind an active authenticated server profile, local signature-pin configuration, bounded payload schema, native confirmation and an asynchronous helper. Qt supplies private root and independently provisioned pin; renderer cannot choose either. Qt validates native result identity and prevents old profile completion events from contaminating the newly selected profile.
4. **Desktop UI.** An authorized release now exposes **Stage retained archive…**. The UI refreshes the device target authorization, checks the committed native archive and offer identity, then supplies only signed sidecars. Native completion updates the existing staging events. Staging never invokes installers or deploys managed content.
5. **Executable evidence.** Native Go unit tests exercise signed stage, missing commit, wrong pin, release mismatch, tamper, duplicate stage. A compiled subprocess CLI smoke test signs an actual ZIP and verifies one successful stage plus negative cases. Cross-layer assertions, G17/G18 regressions, Go vet, and Windows cross-build are retained.

## Scope and limits

- Existing ordinary Package (4 MiB) / MSI (32 MiB) publication caps remain. This is **not** a streaming ZIP publisher or installation pathway. The native verifier still loads the bounded signed archive into **native Go memory**, but renderer memory is not used for staging the retained disk archive.
- A retained archive is not the five-member offline kit and carries **no** install, deploy, grant or license authorization. A signed source and independent SPKI pin are still mandatory.
- Native Qt integration is source-only; the lean package cannot perform an actual Qt Windows build. Windows UI / PostgreSQL / live auth certification remains intentionally deferred.
- The original download lease can expire or be revoked independently of retained bytes. Staging rechecks active target via the renderer before calling the native helper; a locally retained previously staged file is **not** reauthorized for deployment by this operation.

## Remaining TD6 work

Prioritize multi-system feature completion: Calendar recurring occurrence exceptions/delegation, Library/Packet video and recipient-specific distribution, Project/Board/Whiteboard collaboration, Help/configuration, and supervised Package lifecycle recovery. Large upload streaming and cross-Package rollback remain open. Do not expand the current isolated Package implementation into endless instrumentation passes.

**Permanent order:** finish feature implementation in grouped batches; TD7 cleanup and full runtime certification afterward.
