# Production Build Foundation

Phase 7.1-7.6 establishes the release boundary used before installers, signing, provenance, and public certification.

Production certification requires a real npm `package-lock.json` with registry integrity metadata. Exact direct dependency versions in package manifests are necessary but are not treated as a substitute for a resolved transitive lock. Source-only/local packaging may omit the lock only while the release remains `local-unattested`.

TypeScript unit and integration tests are mandatory for release preflight. `tools/scripts/run-tests.mjs` therefore fails when `--require-tsx` is active and the `tsx` runner is unavailable. A certified release may not downgrade that failure into a skipped-test warning.

Server, Web, Shared, and Desktop outputs are recorded by `release-build-foundation.mjs`. The evidence records deterministic tree digests or artifact SHA-256 values. Certification additionally requires `SOURCE_DATE_EPOCH` so two clean builds can be compared against stable inputs rather than wall-clock timestamps.

The Qt desktop package remains a separate toolchain boundary. A machine without the pinned Qt kit may produce source/build-kit evidence, but cannot claim the Desktop reproducible-output gate passed.
