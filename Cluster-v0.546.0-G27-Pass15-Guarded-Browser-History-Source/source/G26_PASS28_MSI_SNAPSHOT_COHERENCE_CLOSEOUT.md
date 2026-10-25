# Cluster v0.546.0 | G26 Pass 28: read-only MSI profile snapshot coherence

Parent: G26 Pass27 Windows Installer multi-context registration admission.

## Delivered source work

- Profile-wide MSI recovery inspection now samples the private root, profile-wide admission lock, attempts directory, and each individual receipt/lock file **before and after** inspecting records. It compares sorted bounded entry names, filesystem identity (`os.SameFile`), file mode, length and modification timestamp.
- A new receipt/lock, replaced receipt, disappearing profile directory, changed global admission state or file replaced under the same name causes the native command to fail. Partial evidence is never published as a complete inventory.
- Existing per-Package receipt parsing, Windows Installer read-only registration assessment, 64-entry scan limit, Qt response verification, and Desktop read-only UI remain unchanged. This does not enable any installer operation or cleanup.
- Deterministic Go tests inject four mid-scan faults: new Package lock, newly held global admission, replaced receipt, and an initially absent profile root appearing. All must reject. The Go race suite tests native code paths; the injection tests are deterministic rather than relying on timing.
- Snapshot agreement only means **two filesystem observations matched while inspecting**. A malicious or external writer can modify files between or after them. It is not an atomic disk transaction, a signed receipt, an OS installed-state proof, a boot/reboot attestation, or permission to retry/repair/uninstall.

## Constraints

- On Windows, filesystem identity/rename semantics and live concurrent MSI activity still require real runtime testing. Linked Qt and PostgreSQL remain unverified. G26-10/11 stay open.
- Preserve Pass27 current-user + machine context query. Do not replace it with `MsiQueryProductStateW` or interpret registration as application health.

## Next work

Windows runtime OS installer/reboot checks, signed package lifecycle ownership, explicit separate repair/uninstall grant design, and dependency-aware rollback. Zero active Cluster production deployments means legacy aliases and migration compatibility are not needed.
