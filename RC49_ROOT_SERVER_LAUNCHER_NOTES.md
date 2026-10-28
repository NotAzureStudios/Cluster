# Cluster RC49: Root Server Launcher and Installer Delivery

## Resolved

The installer builds `bin/Cluster Server.exe` as the portable entry point, but earlier installers never promoted it beside the installer. RC49 publishes it to the parent of the managed `Cluster` folder after a successful install.

For an installer launched from `D:\Cluster-Server\Cluster-Installer-RC49.exe`, the layout becomes:

```text
D:\Cluster-Server\
  Cluster-Installer-RC49.exe     (build / upgrade)
  Cluster Server.exe            (double-click to launch later)
  Cluster\
    installer.log
    root-launcher.manifest.json
    Server\
      bin\ClusterServer.exe    (native server manager)
      apps\...                 (backend and web app)
      data\...                 (persistent database and files)
      runtime\...              (private runtimes)
```

The root `Cluster Server.exe` is a small compiled native entry point. It validates the managed install marker and starts the native Windows server manager with the correct `--root`, not a duplicate server or a `.cmd` script.

## Deployment guardrails

- Root EXE is copied **only after** a successful installation and manifest verification.
- Existing unrelated `Cluster Server.exe` is never overwritten.
- Updates verify the old root launcher SHA-256 against the installer-managed ownership manifest before replacing it.
- The replacement copy is staged, hash-checked, and the old launcher is restored on failure.
- Re-running the installer for the same RC repairs a missing managed root launcher without recompiling.
- The installer and root launcher are separate executables; updating the installer does not change server data.
- If a root executable already exists but isn't installer-managed, move it aside manually before installing. Never overwrite a stranger's EXE automatically.

## What is not certified here

Full Windows installation and live server startup still require testing on Windows with the private Node/Go/PostgreSQL toolchains. The source-building installer is a Windows PE executable; the bundled application is compiled on the target machine.
