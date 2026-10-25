# Windows Server Native Control Panel

Cluster Windows Server uses a small Win32 operations shell for local server administration. `ClusterServer.exe` is a Windows GUI executable built from Go and standard User32/GDI32 controls. It does not embed Cluster Web, Chromium, a WebView, Electron, Qt, or the shared renderer.

## Operator surface

The control panel is intentionally plain and low-cost:

- Start, Stop, and Restart the managed Cluster host. **Running** is only shown after the API readiness probe passes and the web listener is serving, not merely after a process is spawned.
- Use **Repair & Start** from a stopped/error state to force dependency/runtime repair before starting when an upgrade or interrupted bootstrap leaves the local runtime incomplete.
- Open the active Cluster Web endpoint, log directory, or server workspace.
- Stream launcher, database, migration/build, host, and API output into a read-only live log view with semantic Info, Warning, Error, and Success colors. The live view can be filtered without changing the complete on-disk log, copied to the clipboard, and optionally auto-scrolled.
- Run local maintenance commands from the server workspace. `start`, `stop`, `restart`, `status`, `open`, `logs`, and `clear` remain launcher built-ins; other commands are passed to local `cmd.exe`.
- Open a native **Settings** window covering every field exposed by the web Server Configuration page: network, security, storage, backups, Discord, and Git integration settings.
- Save settings to the same protected server configuration path used by Cluster. Secret values are never read back into the native UI. A newly entered protected value is staged locally and imported/encrypted by the server settings service.
- Use **Save + Restart** when a startup-bound setting changes.
- Check for updates on demand. The panel performs no background update polling. Configure a credential-free HTTP(S) manifest with `CLUSTER_UPDATE_MANIFEST_URL`, `CLUSTER_RELEASE_MANIFEST_URL`, or Settings → Control panel → Update manifest URL.
- Run the existing database doctor on demand while the server is running. Update checks and database diagnostics are single-flight, so repeated clicks cannot create duplicate maintenance jobs.
- Show server uptime and PID continuously. A lightweight **Performance** toggle adds system CPU, system memory, server working-set memory, server-drive free-space, and embedded PostgreSQL listener state.
- Toggle **Dark mode / Light mode** directly from the main server window; the preference is persisted alongside the other native panel preferences.

`data/system/logs/windows-server.log` retains the control-panel session output.

## Resource policy

The panel is designed to be effectively idle when nobody interacts with it. It uses no renderer process and no local web management service. A one-second UI timer keeps the uptime counter accurate; expensive resource sampling remains limited to a five-second cadence and only matters when the optional Performance view is visible. Live log notifications are coalesced so startup/build output cannot flood the Win32 message queue and make the panel appear hung. Update checks, database diagnostics, configuration writes, and shell commands only run after an operator explicitly requests them.

Closing the control panel stops the managed server only after operator confirmation. Windows uses one `ClusterServer.exe` executable for both the visual and command-line launch modes.

## Configuration behavior

The native configuration editor mirrors `ServerConfigPage.tsx` instead of maintaining a smaller second configuration model. Its field inventory is release-audited against the renderer field keys.

Values are written atomically to `data/system/config/cluster.config.json` (or `CLUSTER_CONFIG_FILE` when explicitly overridden). The server remains authoritative for validation, database persistence, protected-setting encryption, and compaction. The native editor performs basic type/range validation to catch obvious mistakes before a restart.

Protected values such as database credentials, Discord tokens/webhooks, and Git access tokens are not displayed. Leaving a protected field blank keeps the server-stored value. Reset/Clear intentionally clears that setting.

## Update manifest

Because Cluster is privately distributed, the Windows Server launcher does not assume a public update service. **Check Updates** reads only the configured internal manifest URL. The manifest must be JSON and include one of `clusterVersion`, `latestVersion`, `version`, or `serverVersion`. A `downloadUrl` or `url` is optional and is displayed when a newer version is available. The response is bounded to 1 MiB and uses an 8-second timeout.

## Security boundary

The control panel is local-only. It does not expose a management HTTP route, remote command endpoint, WebSocket console, or browser API. The command field and configuration editor run with the permissions of the Windows account that launched Cluster Server, so Windows account and filesystem permissions remain the administrative boundary.

The launcher does not display or echo managed secrets. Existing `.env`, PostgreSQL credentials, Cluster encryption keys, and database-side protected settings remain server-owned.

## Launch mode and startup

On the first Windows launch, Cluster asks **Use visual interface?** with a simple Yes/No choice before it starts Node.js, PostgreSQL, migrations, or the Cluster host. The choice is stored in `data/system/config/windows-server-ui.json` and can be changed later under **Settings → Control panel → Use visual interface**.

There is only one Windows launcher: `ClusterServer.exe`. `--interface` and `--command-line` provide one-run overrides. Command-line mode attaches to the calling terminal when possible or allocates a console when started directly.

The same Control panel settings also provide **Start server when ClusterServer opens** and **Start Cluster Server with Windows**. Windows startup uses a per-user Task Scheduler entry configured to run at highest available privilege and launches the same executable with `--startup`; no extra resident updater or Windows service wrapper is added.


## Administrator launch and bootstrap responsiveness

`ClusterServer.exe` checks its Windows token immediately and relaunches itself with the standard UAC `runas` verb when required. Runtime/database setup therefore never depends on the operator remembering to use **Run as administrator**. On first run, the **Use visual interface?** Yes/No choice is shown after elevation and before any Node.js, PostgreSQL, dependency, database, or server startup work begins.

The native log view is intentionally throttled and bounded. Full bootstrap output continues to `data/system/logs/windows-server.log`, while PostgreSQL extractor detail goes to `postgresql-bootstrap.log`; the visible edit control receives small batches so installer output cannot starve the Win32 message pump.

**Start Cluster Server with Windows** uses a highest-privilege Task Scheduler entry at user logon. This avoids a UAC prompt blocking unattended startup without installing a resident Windows service.


## Readiness and recovery

The native panel treats process creation and service readiness as separate states. During startup it remains **Starting** while PostgreSQL, migrations, dependencies, the API process, and the host listener come online. The managed host emits an explicit local readiness marker only after its API probe succeeds and the HTTP server is live; only then does the panel enter **Running** and enable Open Web / Database Doctor actions. If the host exits before that boundary, the panel reports an error instead of briefly claiming the server was running.

Maintenance actions are deliberately bounded. Update checking and Database Doctor each allow one active job at a time. **Repair & Start** is available only while stopped or in an error state and reuses the existing repair/bootstrap path rather than introducing another background service or resident repair agent.


## v0.463 production hardening

- Bootstrap npm/build work is cancellable from Stop/close so a long dependency or repair stage does not trap the control panel in Starting.
- Managed-host startup has a 75-second readiness watchdog. Failure to reach the authoritative Ready boundary triggers graceful shutdown, then bounded force termination and a recovery error.
- Resource sampling runs every 5 seconds only while the native panel exists. There is still no background update polling.


## First launch UI choice

The first-run prompt is intentionally minimal: **Use visual interface?** Choose **Yes** for the native Win32 control panel or **No** for command-line mode. The preference can be changed later in Settings.
