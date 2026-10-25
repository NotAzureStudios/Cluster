# Cluster v0.546.0 | TD6 G12: MSI Media Ceiling + Recovery Evidence

**Source baseline:** G11 complete source. **Status:** this connected feature slice is source-implemented; CD-08 and TD6 remain open. **Priority:** implement unfinished features before TD7 and full Windows/PostgreSQL release certification.

## Implemented in G12

1. **Separate installer archive budget.** Ordinary signed content Packages stay at **4 MiB**. Releases with an explicitly declared signed `windows-msi` installer can carry **up to 32 MiB** compressed, still limited to 64 MiB expanded. Applies to offline signer, server publication schema and workload admission, signed manifest validation, device-target projection, renderer's bounded download, Qt kit transfer, native ZIP verifier, and staging kit reader. Large in-memory buffers remain; this is not a genuinely streamed external installer artifact.
2. **Large-envelope validation fix.** Replaced stack-overflow-prone nested base64 validation with a bounded linear character/padding check followed by byte-for-byte canonical base64 re-encoding, signed SHA-256 integrity, ZIP CRCs, MSI member hash, and Ed25519 signature validation. A real 5 MiB signed MSI fixture crosses the signer-to-server boundary successfully.
3. **Native read-only MSI recovery inspector.** New `msi-attempt-status` command reports an existing bounded receipt, its SHA-256, local operation lock, started/unknown or process exit states, and manual-review requirement. Unsafe links, malformed data, unknown states, inconsistent timestamps, and fabricated OS attestation are refused. No deletion, retry, grant consumption, or MSI execution.
4. **Qt + Desktop evidence view.** New local `package.msiAttemptStatus` capability takes only a validated Package key, derives its root from the active Desktop profile, runs the native inspector, verifies response state, and returns a read-only report. The Package panel can inspect local receipts after application restart without staging or running an installer.
5. **Focused checks.** Go native inspector tests, Go vet and Windows x64 cross compilation; 5 MiB signer→server integration; 14 inherited feature suites including G11; TypeScript source/relative import scanner.

## Boundaries and remaining work (do not mark CD-08 closed)

- **No 100+ MB/GB streaming:** Genuine large media needs separately signed blob manifests, chunked resumable transfer, per-chunk verification, canonical object storage and atomic stage/commit. Enlarging in-memory base64 envelopes farther is not acceptable.
- No Authenticode vendor-signature validation, trust policies for custom MSI actions, installed-product identity/health inventory, repair or uninstall, arbitrary EXE execution, machine scope/elevation, or group-wide atomic compensation/rollback.
- No native attempt reset or automatic replay. Operator must investigate any uncertain receipt and may need OS Installer logs/product inventory; local evidence is not tamper-proof attestation.
- G01–G11 source implementation history and all CD-01–CD-20 requirements remain retained. Calendar collaboration, Library, administration, Package and Desktop feature gaps stay open.
- Full Node 24 workspace compilation, real Windows Installer/Qt behavior, PostgreSQL, multi-device and release certification remain deferred by project instruction.

## G13 next grouped build direction

Build a **separate signed large-artifact service** and native streaming installer stage, with OS product identity/status and explicit recovery planning, or pivot into other unfinished CD areas if the independent source audit shows higher immediate delivery value. Avoid another passive roadmap-only pass.
