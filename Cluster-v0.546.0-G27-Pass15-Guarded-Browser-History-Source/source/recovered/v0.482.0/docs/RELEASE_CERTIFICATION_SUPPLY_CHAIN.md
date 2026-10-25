# Release certification and supply-chain boundary

Cluster v0.361 makes release certification an evidence-backed security boundary. A production artifact is not considered certified merely because its files compile or because a packaging environment sets a boolean flag.

## Certification levels

Cluster distinguishes three release states:

- `local-unattested`: useful for development, review, and local testing. It is not production certification.
- `ci-certified`: the required server, database, migration, restore, integration, native-build, automated-accessibility, desktop-smoke, and dependency gates passed for one immutable Git source revision.
- `public-signed`: all CI certification requirements passed and the Windows executables/installer also passed Authenticode verification. Tagged public release assembly uses this level.

`publicDistributionReady` is never inferred from a version number, archive name, or the existence of an installer.

## Evidence ledger

Release gates write bounded evidence records under `.cluster/release-evidence/`. Each record binds:

- gate name and pass state,
- Cluster version,
- immutable Git source revision when available,
- execution timestamp and duration,
- command identity,
- runner/platform metadata,
- a canonical SHA-256 integrity hash over the record.

Certified packaging requires evidence for:

1. full release preflight,
2. high-severity dependency audit,
3. automated Chromium accessibility certification and its hashed runtime report,
4. PostgreSQL-backed integration tests,
5. PostgreSQL backup/restore drill,
6. previous-release database upgrade drill,
7. signed Windows desktop smoke test.

Public distribution additionally requires Authenticode signature evidence.

The final Master carries the accepted evidence records in `Evidence/` plus `CERTIFICATION_EVIDENCE.json`. The artifact verifier recomputes every evidence hash and rejects source-revision or version drift.

## Dependency inventory and SBOM

Every Master contains:

- `RELEASE_INVENTORY.json`, and
- `SBOM.spdx.json` in SPDX 2.3 JSON format.

A local build may create a partial inventory when no lockfile exists. A certified release must have a complete `package-lock.json`-backed dependency graph. The certification metadata binds the SHA-256 of the inventory and SBOM.

The server runtime packages also carry an exact runtime dependency lock. The release metadata records its SHA-256 so Windows and Linux packages cannot silently use different dependency graphs.

## Windows signing

Tagged public releases require Authenticode signing. The signing certificate is supplied only through release-runner secrets and is never copied into source or artifacts.

The signing sequence is deliberately ordered:

1. build native binaries and desktop runtime,
2. sign Windows native and desktop executable payloads,
3. rebuild the portable desktop archive from the signed payload,
4. smoke-test the signed desktop runtime,
5. build the installer from the already-signed payload,
6. sign the installer,
7. independently verify every required Authenticode signature,
8. assemble the final Master without rebuilding those signed binaries.

If `CLUSTER_WINDOWS_SIGNING_THUMBPRINT` is configured, the verifier also requires the signer thumbprint to match it.

## Tagged release provenance

GitHub tagged release certification requires build-provenance attestation for the final Master. Provenance attestation is additive: it does not replace Authenticode, checksums, release evidence, dependency locks, restore drills, or review.

## Fail-closed rules

Certified/public packaging refuses to proceed when any of these conditions occur:

- source revision is unavailable or evidence came from a different revision,
- a required evidence gate is missing,
- evidence integrity hashes do not verify,
- the required accessibility gate/report is missing, failed, version-mismatched, or hash-mismatched,
- dependency inventory is not lock-backed,
- server runtime dependency lock is absent,
- required prebuilt server/web output is missing,
- desktop smoke evidence is missing,
- public Windows signatures are missing or invalid,
- public installer candidate is missing,
- SBOM/inventory hashes do not match the packaged files.

## Local builds

The Master packager remains usable from a source archive without Git metadata, npm dependencies, Qt, PostgreSQL, or signing credentials. Such output is intentionally marked `local-unattested`. This makes local engineering practical without diluting the meaning of production certification.

## Remaining external trust

Cluster's release boundary cannot make the release runner, GitHub account, certificate authority, npm registry, Go module infrastructure, compiler toolchains, or signing-key custody inherently trustworthy. Those remain operational dependencies and should be protected with repository branch protection, least-privilege CI secrets, hardware-backed signing where practical, and independent artifact retention.
