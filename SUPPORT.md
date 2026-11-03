# Cluster 1.0 internal support

Cluster is proprietary internal Azure Studios software; support is provided through authorized studio channels.

**Installation help:** use the [Windows 1.0 guide](docs/INSTALLATION.md) and [Server recovery operator notes](docs/development/NATIVE_WINDOWS_SERVER_RECOVERY.md). Do not remove database/Library directories to fix a failed setup.

**Bug reporting:** create a private repository issue with the affected feature, product and version (Cluster `v1.0.0`, Server RC50/`0.546.0`, or native Desktop `0.482.0`), Windows version, reproduction steps, expected/actual behavior and **redacted** logs. Include whether there may be a data-integrity or authorization risk.

**Security reporting:** follow [SECURITY.md](SECURITY.md). Never post passwords, API tokens or database contents to ordinary issues.

**Development:** see [local setup](docs/development/LOCAL_SETUP.md).

The 1.0 installers are unsigned and have not passed full real-machine deployment acceptance; these limits are disclosed in the [1.0 release notes](docs/releases/CLUSTER_1_0_0.md).
