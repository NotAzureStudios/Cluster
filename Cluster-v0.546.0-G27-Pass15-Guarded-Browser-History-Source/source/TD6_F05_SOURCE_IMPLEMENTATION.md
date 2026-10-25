# Cluster v0.546.0 — TD6 F05 protected Packet audio previews

## Implemented production source

- `apps/server/src/domains/library/packet-file-audio-derivative.ts`: checks pinned source revision and SHA-256 and reads via the existing bounded, path-confined Library file reader. Only PCM 8/16-bit WAV, mono/stereo, 8–48 kHz, at most 1 MiB, and `public`/`internal` classification is supported. Unsupported types are excluded. Eligible malformed media fails publication closed.
- A fresh, deterministic, metadata-free RIFF/WAV excerpt is generated using a pure TypeScript decoder/resampler: 12 kHz, 8-bit mono, at most eight seconds (96,044 bytes). No source WAV chunks, tags, file names or byte streams are returned as recipient artifacts. Other formats and full-audio downloads are NOT supported.
- `packet-routes.ts`: preview eligibility, explicit `audioDerivatives` opt-in, precommit artifact generation, transactional manifest/source revision confirmation, immutable derivative records, fresh recipient audience checks, MIME/attachment delivery, ZIP bundle integration and activity evidence.
- `packet-publication.ts` + `packet-bundle.ts`: SHA-256, byte limits, structural WAV integrity verification, preview-only catalog marker, generated ZIP entry path `media/preview-NNNN.wav`, and delivery manifest `deliveryKind=excerpt`. Existing txt/pdf/webp delivery remains compatible.
- `PacketsPage.tsx`: separate audio-preview publication choice, eligibility information, format-specific download labels, and a generic detached-derivatives ZIP title. Existing publication, other adapters, revocation and Packet completion preserved.
- The source-level author-preview workflow deliberately does not render videos or run external codecs. Packet source authorization and personnel-record protection remain in force.

## Safety boundaries

1. A Packet entitlement never grants direct canonical Library access. Source revision/checksum, file path and classification are validated before reading. No original media bytes or private release manifest are sent to recipients.
2. Publication is opt-in. No fallback to original audio if the parser, provenance, authorization or output checks fail. Unsupported MP3/AAC/FLAC/video formats remain unavailable.
3. Previews only: 8 seconds maximum, 12 kHz mono, 8-bit PCM, intentionally reduced quality. This is not a full-fidelity audio distribution engine.
4. Max eight audio previews per release, each bounded to 96,044 bytes. The shared detached-delivery budget remains 1 MiB and the ZIP remains bounded to 1.5 MiB.
5. The server dynamically verifies the original frozen recipient audience on each catalog, individual download and bundle request. Revoked releases and tampered blobs fail closed; activity records exclude source file details.
6. Runtime certification remains deferred under the user's October 17 implementation-first directive. No real PostgreSQL migration was necessary; this uses the existing `PacketReleaseDerivative.format` string.

## Remaining CD-07 and follow-on

- Full-fidelity source-safe audio derivative processing and limits; MP3/AAC/FLAC and video frame/proxy adapters, suitable worker isolation, transcode time/memory budgets, generated watermarks and configurable retention policies.
- Real decoder/codec/native-adapter runtime acceptance, live storage and multi-client checks under the separate release-certification roadmap.
- TD6 next priority: CD-08 managed Package deployment/update/rollback and related Desktop integration; CD-04 People lifecycle/offboarding; remaining CD-03 collaboration functionality.
