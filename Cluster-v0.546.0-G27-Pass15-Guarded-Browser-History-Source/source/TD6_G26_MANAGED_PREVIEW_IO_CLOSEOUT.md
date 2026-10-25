# Cluster v0.546.0 | TD6 G26 Managed Preview I/O Reliability and File Safety

## Parent baseline

Exact parent: `Cluster-v0.546.0-TD6-G26-MSI-Launch-Intent-Recovery-Evidence-Source.zip`.

## Connected implementation

1. **Descriptor-backed model preview / thumbnail delivery.** The Library opens and checks a regular single-link managed file once, compares its opened handle with both pre/post path metadata, then gives the open descriptor's stream to Fastify. A rename/replacement after validation no longer silently changes which inode is delivered. Symlinks, hardlinks, escapes, mismatched current path evidence and oversized thumbnail files are rejected.
2. **Opened-byte format verification.** Thumbnail delivery requires matching PNG / JPEG / WebP bytes; cached converted GLBs require the glTF v2 header and a declared length equal to the opened file. A corrupt or replaced cached preview fails closed rather than streaming arbitrary bytes.
3. **Serialized thumbnail replacement.** User-provided model thumbnail data is stored via an unpredictable O_EXCL temporary file, file sync and atomic rename. A per-item filesystem lock prevents overlapping writers and remains fail-closed after a crash (no automatic lock stealing). Existing variants are prevalidated, cross-extension updates remove obsolete variants and suspicious links/hardlinks cannot be overwritten.
4. **Shared test coverage.** A new executable filesystem regression suite exercises normal writes, format switching, bad identifiers/payloads, linked files/roots, retained locks, path replacements after descriptor opening, invalid file magic and malformed GLB headers. Existing Library media tests were updated to assert the new shared module instead of obsolete inline root-checking.

## Explicit limits

- This is a non-destructive managed *runtime preview* implementation, not a general-purpose Library deletion protocol. Windows filesystem ACLs, SMB/NAS races and junction behavior still need live testing.
- No background thumbnail cleanup or file destruction is authorized. If a writer crashes with a lock held, an administrator must inspect the state before removing it.
- The source archive remains lean: no Node 24 workspace dependencies, generated Prisma client or ready PostgreSQL 18 instance. Native Windows installer and Qt acceptance remain unverified.
- Neither independent provider credential revocation nor storage generation-fenced disposal was added. G26 certification remains open.

## Acceptance test additions

`npm run cluster:td6:g26:managed-preview-io` is incorporated into `cluster:td6:g26:model-runtime` and therefore `cluster:td6:g26:one-batch`. This suite executes real temporary-filesystem operations with a Node 22 strip-only test runner. It is not a substitute for a Node 24 production build.
