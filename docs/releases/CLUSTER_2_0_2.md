# Cluster 2.0.2

Windows Server patch for 2.0.1.

## Fixes

- **Project setup failed with "Git is unavailable" while Git was installed.** The Server runs `git` from its PATH. Started as a service, or by a launcher opened before Git was installed, that PATH didn't include Git, and restarting the Server kept the same PATH. The launcher now finds Git for Windows (its install record, the current system and user PATH, then the standard install folders) and gives the Server its `cmd` folder, which includes Git LFS.
- The launcher no longer corrupts the first PATH entry when it adds Node to the Server's PATH (Windows names the variable `Path`).
- When Git is still unavailable, the error says why, for example that `git` wasn't found on the Server's PATH.

## Installing

Run the 2.0.2 `Cluster-Installer.exe` in the same parent folder as the existing installation. It upgrades in place and keeps your data. 2.0.1 Servers are also offered 2.0.2 as an in-app update.
