# Cluster v0.546.0 | G26 Native Transfer Qt Boundary, Pass 6

**Parent:** `Cluster-v0.546.0-G26-Native-Transfer-Linear-IO-Pass5-Source.zip`. This is a focused, cumulative Qt/renderer integration pass, not a new architecture. The unified final master roadmap and G26 work items remain open until validated end to end.

## Closed source defects

1. The Qt native capability broker previously received and forwarded the entire checkpoint v2 JSON returned by the Go helper, including its non-authoritative serialized SHA-256 progress state, bounded tail checksum, and OS file modification time. After parsing and validating the helper response, Qt now removes `hashState`, `tailSha256`, and `payloadModTimeNano` before returning the public checkpoint to the renderer. These fields continue to exist only in the Go helper's private durable checkpoint. The renderer still receives digest, progress, offer identity, recovery action and safe display fields. The diagnostic path retains its distinct read-only schema-1 contract.
2. The 384 KiB archive-chunk limit caused up to 86 native helper launches for a 32 MiB Package archive. Qt and renderer now use a shared **512 KiB per segment contract**, reducing that upper bound to 64 launches (before retries). This does **not** imply a persistent helper session or change network reauthorization. Qt still validates canonical base64 encoding, decoded size and the request envelope before invoking Go. The full parsed request stays below a separate 768 KiB cap and payload below 736 KiB; Go independently refuses chunks over 4 MiB.

## Security and verification

- No installer, elevation, filesystem path, bearer or signing key is exposed through the new response. Qt validates the raw response digest/schema/length before projecting fields.
- No background polling, automatic recovery, token retention, or new privileged operations are added. Package offer/source identity and every server HTTP segment must remain independently authorized.
- The helper's SHA-256 streaming state is only transport progress, never independent signed Package evidence. Full payload hashing, Ed25519 signature and pinned public key checks remain mandatory before installation.
- New `tools/scripts/cluster-g26-native-transfer-qt-bounds-tests.mjs` enforces Qt/renderer 512 KiB alignment, independently bounded envelopes, canonical base64, schema-2 result validation, internal field filtering and schema-1 read-only diagnostics.
- Inherited native Go tests, signed-kit checks, transfer crash recovery, diagnostics and source scan were rerun. Qt 6.11.2 was **not** compiled here; Windows 10 native runtime remains untested.

## Still open

G26-08/09: general-purpose browser/mobile/desktop Transfer Center, cancel/retry/revocation and multi-window durable recovery, helper-per-segment process overhead, real Windows 10/Qt acceptance. G26-10/11: MSI installed-state attestation, repair/uninstall and reboot recovery. No new Prisma migrations. All claims are source-level only.
