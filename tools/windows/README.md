# Windows native server tooling

**Cluster Installer** is the canonical one-icon installation and revision workflow. Its maintained source and packaging scripts live in `tools/installer/` and `tools/scripts/build-cluster-installer.mjs`. Run `npm run cluster:installer:build` when publishing an updated source checkpoint.

The retired Batch E/F `Install-Cluster-TestRevision.ps1` and `Install-Cluster-Test.cmd` scripts and their obsolete tests were removed. Historical records remain in the development handoffs; all installation behavior now has one source of truth.

`Install-ClusterNativeService.ps1` handles native service provisioning. `Test-ClusterWindows10Readiness.ps1` is a Windows readiness diagnostic. The installer does not bypass the native Server Manager's service safety checks, UAC, or first Owner enrollment.
