# Cluster 0.513 | Managed Package + Packet note-PDF development

**Status:** feature-implementation checkpoint, not native or PostgreSQL runtime certified. Baseline: the verified, authoritative Pass 15 three-way merged `0.512.2` source. No Pass 14/15 changes were intentionally removed.

## Feature implementation

### Managed Package distribution authority (new PostgreSQL schema)

- Admin-only Package catalogue, trusted Ed25519 public signing keys, immutable artifact records with verified signature and SHA-256 integrity, explicit key and release revocation, and durable audit.
- Reject unsafe signed ZIP packages at intake: malformed structure, traversal, links, encryption, compressed expansion abuse, duplicates, and unsupported archive features. Bounded artifact sizes.
- Stable/beta/testing channel rollouts, deterministic staged rollout cohorts, optimistic revision-controlled updates, pause and previous-release rollback targeting, device-specific version pins and removal.
- Pins now require a verified, nonrevoked DeviceRegistration identity; admin preview fails closed for unknown/revoked devices. People offboarding previews pinned Package impact and removes those pins transactionally before revoking devices/sessions.
- Studio Systems administrative UI and local Ed25519 signing utility. Private keys stay outside Cluster. **No workstation executable installation/activation or public device update feed yet.** Signing a ZIP does not establish software safety beyond bounded transport/package format restrictions.

### Detached note-to-PDF Packet distribution (new PostgreSQL migration)

- Authors explicitly opt into either detached UTF-8 notes or newly generated standalone PDF copies of *eligible text-note content*, pinned to the published Packet release.
- PDFs do not grant source Library ACLs, are capped by content and release sizes, and use SHA-256 integrity plus frozen recipient audience checks for download and combined release ZIP bundles.
- Invalid/unsupported note glyphs are omitted from PDF delivery rather than silently substituted. The Packet editor and recipient browser show correct PDF type.
- **Uploaded Library PDFs, images, video, audio, 3D, arbitrary attachments and watermarking are not processed by this adapter.** These remain to implement after source rights/security review.

## Evidence and limitations

- New source-driven Package tests execute route closures using an isolated simulated transactional database; no PostgreSQL or Prisma Client execution is claimed.
- Packet PDF tests use a deliberately mocked `pdf-lib` renderer. Actual output rendering, page metrics and viewer interoperability must be tested in a dependency-backed runtime. A signed Package envelope/ZIP still requires a real workstation installer trust/execution lifecycle.
- Existing source regressions and repository static parsing were run after integration. Full build, migrations, Windows and multi-user/real-device tests remain deferred by user direction.

## Next development targets

1. Native installer trust handshake, device discovery + eventual signed package install/rollback contract, without exposing unverified artifacts.
2. Actual Library source PDF and media derivative pipeline with metadata policy, watermarking and output rights.
3. Complete shared Work collaboration, comments/mentions, undo/redo, revision conflict/replay.
4. Company/Vault/Inventory and Studio administration end-to-end UX, Library collections, scheduling overlays, Git/LFS and Desktop integration.
