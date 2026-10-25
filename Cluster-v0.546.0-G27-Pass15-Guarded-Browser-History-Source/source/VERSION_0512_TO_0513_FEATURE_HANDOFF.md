# Cluster 0.512.2 -> 0.513.0 | Consolidated feature implementation handoff

Baseline: `Cluster-v0.512.2-Pass15-Authoritative-Merged.zip` from the exact Pass 13 and Pass 15 source merge. Current source version `0.513.0`.

Canonical additions:
- `apps/server/src/domains/inventory/managed-package-{routes,policy}.ts` and Prisma `20261009040000_managed_package_catalogue`.
- `packages/renderer/src/features/settings/StudioManagedPackagesPanel.tsx` integrated under Studio Systems.
- `tools/scripts/cluster-package-sign.mjs` signs immutable ZIP envelope offline with Ed25519 private key.
- `apps/server/src/domains/library/packet-pdf-derivative.ts`, `20261009050000_packet_note_pdf_delivery`, Packet publishing/downloading, recipient ZIP integrity and editor UI changes.
- Verified DeviceRegistration pins and automatic offboarding revocation; People offboarding impact/receipt UI.
- New source executable checks `cluster-0513-managed-packages-assertions.mjs`, `cluster-0513-packet-pdf-assertions.mjs`; inherited tests updated to allow optional PDF imports safely in mocks.

Guardrails: `managedPackageRelease` artefact storage is a controlled release registry, not an installer agent. Never execute ZIPs on the Cluster Server. Rollout endpoints are admin-only plans, not an unauthenticated device feed. Packet note PDFs are derived copies of text notes, **not** uploaded source PDFs or arbitrary Library media, and recipient access never grants source ACLs. No backward-compat shim for unused beta contracts. Release revision and signing key revocation must fail closed.

Missing features: native signed update/install agent with correct fail-safe install and rollback, device attestation beyond currently verified registrations, byte-range and object storage paths for larger signed distributions, source PDF/media derivatives, personalized watermarking, License/Entitlement UX, Work Undo/Redo and reviews, broad Studio/Library/Calendar/People completion, Git/Discord/Desktop parity.

Verification: focused Package and Packet note PDF source/mocked-route tests, inherited regression suites, static parser/import scan and artifact manifest/patch replay. Not yet certified: Node24 dependency-backed compile, Prisma generation and migration on PostgreSQL, actual `pdf-lib` rendering, multi-user device proof, OS installer, backups/recovery, Windows/Qt. The user explicitly opted to defer comprehensive compile/certification while developing features. No production readiness claim.
