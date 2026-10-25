# Cluster 0.531 → 0.532 handoff

**Authoritative source**: `Cluster-v0.532.zip`. Previous baseline `Cluster-v0.531.zip`. This pass only changes native Qt broker, renderer Desktop Package API/panel, tests and release documentation. Go stager binary/source, Prisma schema and migrations remain unchanged.

### What changed

Added native `package.kit.begin/chunk/finish/cancel` contract with ephemeral, authenticated, single-profile, size- and SHA-256-bounded ZIP handoff. Renderer still performs registered ES256 device request and artifact hash checks; Qt uses separate pinned signing trust and native confirmations; Go verifies Ed25519 release signature and staged bytes. The Package panel now exposes one-flow Download & Update using an authenticated signed kit, staged Go verifier and post-verification fresh entitlement check. Existing manual/offline ZIP workflow preserved.

### Security invariants

- Renderer never supplies a destination filesystem path, native signing pin or installation authorization.
- Browser-supplied full-kit hash is a transport-integrity check, not an independent signature. The trust pin is local to Qt; Go signs off on exact Package digest/key/version separately.
- Native import uses private temporary files and exact sequence/length/hash checks, expires after ten minutes and clears on profile change; no Package script or executable is run.
- Fresh device rollout check before staging and again immediately before destination file update. Qt confirmation required.
- No assumption that a signed release remains authorized forever. No OS installation/attestation claims.

### Validation

Run `NODE_PATH=$(npm root -g) node tools/scripts/cluster-0532-native-kit-handoff-assertions.mjs`, `go -C tools/native/package-stager-go test ./...`, and focused inherited suites. Qt/Windows runtime and full DB certification deferred. See `CLUSTER_0532_VALIDATION_RESULTS.md`.

### Next milestone

Finish truly opt-in unattended Package file-update policy and status/cadence, then close Library and Work workflows. Avoid returning to OS installer designs.
