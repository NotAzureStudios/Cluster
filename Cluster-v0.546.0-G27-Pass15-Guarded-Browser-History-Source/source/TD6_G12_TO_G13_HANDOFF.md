# Cluster TD6 G12 → G13 handoff

**Current authoritative source:** `Cluster-v0.546.0-TD6-G12-Installer-Size-Recovery-Evidence-Source.zip` (when packaged). Continue only from this updated source, not G11.

G12 keeps ordinary ZIP content at 4 MiB while permitting a **bounded 32 MiB signed MSI release**, with verified canonical base64, hash, signature, ZIP and member constraints. Qt and renderer adhere to the same installer-specific ceiling. It also adds native read-only `msi-attempt-status`, evidence validation, and a Desktop report after restart. The inspector **never** authorizes retry, erases a receipt, starts Windows Installer, or claims OS attestation.

What remains: true separate large signed artifact transfer/streaming and resumability; product-code/version inventory, vendor/Authenticode signature policy; safely supervised elevation and repair/uninstall; intentional human resolution of uncertain attempts; cross-Package dependency-group recovery/rollback. Unfinished CD-01–CD-20 items remain, with feature implementation first, TD7 cleanup second, Windows/PostgreSQL runtime certification last. See `IMPLEMENTATION_ROADMAP_TD6_G12.md`.

Validation results and exact archive/patch hash will appear in the adjacent G12 integrity report. No schema migration was required. Native Windows x64 cross-compilation is **not** a Windows-runtime test.
