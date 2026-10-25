# Legal / Privacy / Accessibility Release Readiness & Evidence Consolidation

Cluster v0.381.0 completes **Legal / Privacy / Accessibility Roadmap Step 20 of 20**. This final step consolidates engineering evidence for the preceding roadmap work and makes that evidence part of Cluster's release-certification boundary.

## What Step 20 proves

Cluster now generates a machine-verifiable roadmap evidence manifest with one record for every roadmap step. Each record binds the step number and release to its documentation, release notes, an implementation/test anchor, and the relevant server capability where one exists. Each file is SHA-256 hashed and the complete manifest carries a canonical integrity hash.

The release packager generates this manifest before assembling a Cluster Master. Certified release workflows additionally record a `legal-readiness` release gate. Certified/public release verification fails if that gate or the consolidated roadmap evidence is missing, incomplete, version-drifted, or hash-invalid.

This is an **engineering and release-readiness claim only**. The manifest deliberately records `legalCertification: false`. Cluster cannot determine which laws apply to an operator, whether operator-supplied policy text is sufficient, whether contracts with processors are adequate, or whether a particular deployment satisfies legal obligations.

## Operator deployment evidence export

Legal & Compliance now provides a **Download evidence snapshot** action. The export is administrator-only, uses a POST request so Cluster's recent-authentication/CSRF/origin boundary applies, and records the export in the security audit trail.

The exported JSON contains aggregate deployment posture only: current immutable policy versions/content hashes, acceptance integrity/counts, consent/retention/analytics/third-party posture, privacy-request/legal-hold counts, copyright workflow counts, engineering-control flags, current warnings, API contract version, roadmap completion metadata, and a SHA-256 evidence digest.

It intentionally excludes user lists, policy acceptance identities, raw security events, credentials, secrets, private integration hosts, message/file content, and other evidence that would turn a compliance export into a fresh privacy problem.

## Release boundary

For a certified release, Cluster requires the normal supply-chain/runtime gates plus the legal-readiness gate. The final Master archive carries `Evidence/legal-privacy-accessibility-roadmap.json`, and artifact verification checks its version, 20/20 completion state, non-certification disclaimer, descriptor hash, and canonical record hash.

A local source-only package can still be assembled as `local-unattested`; that classification does not become a certification merely because the roadmap implementation manifest is complete. Runtime accessibility evidence, dependency provenance, integration tests, backup/restore, upgrade drills, desktop smoke testing, and signing remain separate certification requirements.

## Roadmap completion

Steps 1–19 remain individually documented and release-gated. Step 20 adds the final evidence index rather than replacing those controls. The roadmap is therefore **20/20 implementation-complete in v0.381.0**, while deployment-specific legal review remains the operator's responsibility.
