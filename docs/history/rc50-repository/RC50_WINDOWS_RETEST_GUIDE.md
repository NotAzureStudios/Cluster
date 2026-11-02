# RC50 Windows retest

1. Extract the `Cluster-Installer-RC50-NAVIGATION-BUILD-FIX.zip` archive, or use the standalone EXE.
2. Place the installer EXE directly in `D:\Cluster-Server\` (outside the managed `Cluster` subfolder).
3. Stop the existing Cluster Server Manager, then run the installer. The candidate is built in isolation and the currently managed installation is not replaced until the build succeeds.
4. Verify the renderer passes `tsc --noEmit` and the remaining `npm run build` stages complete.
5. Verify `D:\Cluster-Server\Cluster Server.exe` is published in the root folder after installation, then use it to start the Server Manager.
6. Verify web/API readiness, and confirm that opening and closing a Board returns to its originating page.

The RC49 error was `TS2339` at `packages/renderer/src/features/application/ClusterApplication.tsx:179`: `AppNavigationState` does not have a `screen` property. RC50 initializes the board's last-screen ref using `initialNavigation.state.route`, matching the navigation state contract.

If the installer reports another error, the authoritative log is `D:\Cluster-Server\Cluster\installer.log`. Preserve the first compiler error, not just the final `npm error` summary.

RC50 is a test release. The dependency graph is still missing a committed `package-lock.json`, and this environment cannot certify the full Windows build.
