# Cluster RC50 | Windows renderer build hotfix

## Reported failure
On the RC49 Windows installation, native Go build checks, Prisma client generation, server TypeScript and API client TypeScript succeeded. The renderer failed at `packages/renderer/src/features/application/ClusterApplication.tsx:179` with TypeScript TS2339: `Property 'screen' does not exist on type 'AppNavigationState'`.

## Corrective change
The navigation state type, created by `createNavigationState`, stores the current route in `.route`, not `.screen`. The application's board-return-origin ref now initializes from `initialNavigation.state.route`, matching all neighboring initialization paths. This preserves the logic that returns a Board to its originating workspace.

The release sequence advances to RC50 so the managed installer recognizes this source as newer than RC49. The root-level `Cluster Server.exe` publication from RC49 is unchanged. A dedicated regression test (`tools/scripts/cluster-rc50-navigation-compile-tests.mjs`) verifies the canonical navigation contract and both initializers.

## Testing and limitations
Run the RC50 test installer from the parent folder (`D:\Cluster-Server`). It will rebuild a candidate in an isolated directory and preserve the existing managed installation if any compile step fails. The full Windows application build still requires confirmation on an actual Windows system, including Prisma generation, `npm run build`, and readiness. This environment does not contain the application's installed npm dependency graph or the pinned Windows runtimes.

The existing `package-lock.json` reproducibility warning remains unresolved; RC50 is not a stable release.
