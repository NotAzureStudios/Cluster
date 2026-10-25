# Cluster 0.520.0 | Distribution & Deployment implementation

## Package staging and receipt authority

- Reuses the renderer's existing non-exportable ES256 device identity to request authorized Package targets and downloads. The downloaded artifact has a server-issued time-bound, single-use receipt lease that is held in memory only, never inside a kit or native Qt process.
- Selected release SHA-256, Package key and release version are passed to the independently pinned native Go helper through a strictly allowlisted Desktop capability payload. The helper rejects a signed release that does not match these selected identity constraints before writing staged content.
- Go helper emits bounded structured staging evidence after successful local verified staging. Qt checks the helper's reported identity and independently provisioned signing-key fingerprint before presenting `staged_not_installed` status.
- A native completion signal must match the selected authorized release identity. If a valid unexpired lease remains, the renderer submits sequential, server-verified, one-time `artifact_verified` and `staged` receipt transitions, or a failure report if native verification rejects content. Invalid/expired/revoked authorization cannot be replayed as a positive receipt. A missing lease leaves a local-only stage result.
- **Security limit:** this is still a device-authored report of cryptographically verified staging; not attested OS installation, activation or rollback. The Go helper's original stage/activate/rollback verbs only manage local content and pointers. Native package installation is not shipped.

## Packet publication and detached uploaded text files

- Extends the explicit `textDerivatives` publication mode from detached database text notes to eligible `.txt` Library uploads. Publication snapshot checks revision and SHA-256 integrity against actual stored bytes, copies detached normalized UTF-8 contents, and preserves the immutable published-release/recipient-entitlement architecture.
- Bounds original file size to 64 KiB and total selected input to 1 MiB. Restricts eligible MIME/type/classification to `text/plain`, `.txt`, public or internal. Rejects path traversal, symlink sources, files outside Library root, nonregular files, malformed UTF-8, binary NULs, and stale or tampered data.
- Blocks publication of Library sources additionally governed by Personnel Records attachments; separate Personnel authorization must not be bypassed by including such sources in a Packet.
- Publication preview and Packet UI show detached plain-text file eligibility. Existing text notes, optional note-PDF derivatives, release pinning, audience authorization, ZIP downloads and auditing remain present.
- **Security limit:** original binary PDF/image/video/audio adapters and supported document sanitization/watermarking remain on the roadmap; unsafe binaries are not silently bundled.

## Other housekeeping

- Corrects canonical VERSION_NAMING_CONVENTION metadata from v0.515 to v0.520, which was lagging behind the actual package versions.
- New tests cover staged digest tampering, mismatched signed identity, receipt challenges/revocation, artifact file integrity, symlink/path escape, classifications, personnel policy and previously implemented flows.
- Go Windows helper rebuilt from the updated source and included as an unaudited **native staging utility**, not an application installer.

## Certification gates not yet passed

Full semantic TypeScript build with dependencies and generated Prisma, live PostgreSQL and migration tests, Qt6/MSVC Windows compilation and runtime, supervised OS installation and rollback tests, real multi-user/security load tests and production packaging certification. Zero production users means no compatibility shims or legacy aliases are introduced.
