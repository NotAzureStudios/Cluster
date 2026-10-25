# Cluster v0.517.0 → v0.518.0 development handoff

## Canonical source

Base: `Cluster-v0.517.zip` (full `source/` tree); current: `Cluster-v0.518.zip` (`source/` full tree), with reproducible text patch `Cluster-v0.518.patch`. Preserve **all** earlier v0.505/RC17, Pass 15 authoritative reconciliation and v0.506–0.517 changes. The root source manifest is authoritative for bytes.

## Work completed

- `packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx`: opt-in Desktop Account Settings Package target discovery; bounded download and double-check of signed target metadata and artifact hash; on-demand portable kit creation; explicit nonattestation state.
- `packages/renderer/src/features/settings/package-staging-kit.ts`: constrained ZIP writer containing only five verified, nonprivileged handoff entries.
- `packages/renderer/src/features/settings/AccountSettingsPage.tsx`: Desktop tab integration without renderer startup/module eager loading outside the settings route.
- `tools/scripts/package-qt-desktop.mjs`: compile and include native Go stager executable in Qt Desktop archive; standalone utility never called automatically.
- `tools/scripts/cluster-0518-device-stage-kit-assertions.mjs`: genuine signed ZIP fixture and Go staging verification test, plus UI wiring and safety assertions.

## Trust boundaries to preserve

- Renderer ES256 proof private key stays non-exportable; Qt gets no cloned device credentials.
- Only the server authorizes the Package feed and artifact delivery; SHA-256 is checked after bounded download and against server assertion, **not** a substitute for Ed25519 key-pin validation in the stager.
- The PEM embedded in the server-delivered kit is not a trust root. The stager requires a *separately provisioned* trusted SHA-256 DER/SPKI fingerprint.
- No receipt challenge, password, cookie, bearer token or cryptographic private key goes inside a kit.
- No client-selected channel/platform, device report, successful staging or rollback pointer may be described as OS attestation or installation.
- No legacy aliases, compatibility scaffolds or silent trust fallback should be introduced.

## Outstanding requirements

1. Explicitly authenticated Desktop/native download coordinator, with independent trusted-key pin provisioning and fresh server entitlement/revocation revalidation before stage/select.
2. Installation service that can atomically deploy managed content to approved roots, detect local edits, check health, undo failed deployments, audit and report real OS operations. Keep the unprivileged Go verifier separated from this service.
3. Native Qt release build on Windows with MSVC/Qt toolchain; real runtime multi-account/PostgreSQL security tests and performance profiling.
4. Original-binary Packet PDF/image/video/audio derivatives with safe transforms, watermark/metadata-stripping where authorized, and Library source isolation.
5. Shared Work collaboration, command history and undo/redo, then remaining feature ledger/certification.

Do not call this production certified. Consult `CLUSTER_0518_VALIDATION_RESULTS.md` and run the deployment security acceptance matrix on actual Windows Desktop machines before enabling installation.
