# Production UX Gate — Phase 18

Cluster v0.441.0 closes the production-polish roadmap by turning the previous seventeen phase gates into one explicit release-readiness contract. The purpose is not to create another badge. The purpose is to make it impossible for a source-only package, an unbuilt web tree, missing browser evidence, or an unsigned Windows payload to be described as an attested production release.

## Release classifications

Cluster has exactly three release classifications:

- `local-unattested` — useful for development, review, local QA, and source/package validation. It is not production certification.
- `ci-certified` — bound to an immutable source revision with the complete dependency graph, built server/web/shared outputs, runtime accessibility, production E2E, runtime performance, database recovery/upgrade evidence, and a smoke-tested desktop runtime.
- `public-signed` — all `ci-certified` requirements plus verified Windows Authenticode evidence and the signed installer candidate required for public distribution.

No environment flag can create certification by itself. `CLUSTER_RELEASE_CERTIFIED=1` and `CLUSTER_RELEASE_PUBLIC=1` only switch the tooling into fail-closed mode; the required evidence still has to exist, match the Cluster version, match the immutable source revision, and pass integrity validation.

## Certified evidence set

A certified release requires evidence for:

1. full release preflight
2. dependency vulnerability audit
3. legal/privacy/accessibility readiness
4. runtime accessibility
5. UX consistency
6. production E2E
7. integration tests
8. PostgreSQL backup/restore drill
9. previous-release upgrade drill
10. desktop smoke test
11. strict bundle budget
12. real 10k search performance microbenchmark
13. runtime performance
14. Phase 18 production UX gate
15. final production-readiness verdict

Public distribution additionally requires Windows signature evidence.

## Built-output boundary

Certification requires actual built server, web, and shared output plus an exact package lock. Missing `apps/web/dist` is no longer merely a bundle-budget note when certification is requested. The strict bundle budget fails closed when the built web output is missing.

A source-only local master can still be packaged. Its readiness report explicitly stays `local-unattested`.

## Runtime accessibility and UX

Static accessibility and design-system audits remain valuable, but they do not substitute for Chromium evidence. Certification therefore requires the runtime accessibility report in addition to the static gates.

The existing UX consistency release gate remains mandatory, covering representative high-use surfaces, semantics, focus behavior, native-dialog debt, inline-style debt, and other one-way consistency ratchets.

## Production E2E

Certification requires the production browser E2E scenario. It exercises real authenticated mutation boundaries, project/workspace creation, collaboration, session lifecycle, reconnect behavior, hostile inputs, bounded soak, renderer data, and keyboard command behavior against PostgreSQL and the built renderer.

## Runtime performance

Phase 17 established the budgets. Phase 18 makes runtime evidence mandatory for certification.

`performance-ci-phase18.mjs` starts the built server and web output against an isolated PostgreSQL schema, authenticates through the shared renderer, traverses representative routes, exercises command search, exports the real client performance report, fetches the real server performance-budget report, and runs the Phase 17 runtime gate in fail-closed mode.

The runtime performance evidence does not replace the 10,000-record search microbenchmark or bundle budget. Certification requires all three because they protect different failure modes.

## Bundle budget

`bundle-budget.mjs --require-built` is the certified path. It fails if built web output is absent and enforces JavaScript chunk, CSS chunk, total payload, and asset-count budgets.

The non-strict mode remains available for local source packaging and reports bundle evidence as unavailable instead of inventing measurements.

## Supply chain and provenance

Certified releases remain bound to:

- immutable source revision
- exact dependency lock
- complete dependency inventory
- SPDX SBOM
- hashed gate evidence
- final artifact hashes
- tagged workflow provenance attestation

Public release additionally requires verified Authenticode signatures for the Windows payloads.

## Final production-readiness report

`production-readiness-phase18.mjs` writes `.cluster/production-readiness.json` and is packaged as `PRODUCTION_READINESS.json`.

The report records:

- classification
- missing/invalid evidence
- built output posture
- dependency-lock posture
- runtime accessibility posture
- client/server runtime performance-report posture
- desktop runtime posture
- public signing posture

When certified/public mode is requested, missing evidence is a hard failure. When running locally from the source archive, the same tool remains useful but reports `local-unattested`.

## Release policy

The production gate is intentionally boring and strict. Visual polish, source audits, and local packaging can all succeed while production certification remains unavailable. That is the correct result when runtime or provenance evidence is missing.

A release earns `ci-certified` or `public-signed`; it does not inherit those labels because somebody set an environment variable and felt optimistic.
