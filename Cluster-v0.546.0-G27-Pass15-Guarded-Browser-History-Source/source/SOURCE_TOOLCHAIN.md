# Cluster v1 Source Toolchain

This reconstructed master is being upgraded while recovered source is forward-ported. A recovered tool is not considered current merely because it was copied into the tree.

## Supported v1 developer baseline

| Layer | v1 source baseline | Policy |
|---|---|---|
| Node.js | 24.20.0 | Must satisfy the root `engines` range. Production/private runtime remains version-pinned by release tooling. |
| Go | 1.27.1 | Required for official native helper rebuilds. `GOTOOLCHAIN=local` is used by release scripts so builds do not silently download another compiler. |
| Qt | 6.11.2 | Desktop source baseline. Patch updates within 6.11 are preferred after Desktop parity testing. |
| Git for Windows | 2.56.0 | Private Desktop runtime baseline for Windows packaging; system Git is development/recovery fallback only. |
| Git LFS | 3.8.0 | Private Desktop LFS runtime baseline. Unreal binary locking depends on this path being available in packaged Desktop builds. |
| CMake | 3.31.0 minimum / 4.4.4 recommended | Desktop declares policies compatible through CMake 4.4 and enables strict compiler warnings. |
| C++ | C++20 | No compiler-specific language extensions. |
| PostgreSQL | 18.6 | Private runtime/database target for current RC17 source. |
| Unreal Engine | UE 5.8 first certification target | The source-control provider must isolate engine-version adapters so additional supported UE5 lines do not fork Git authority. |

The machine-readable authority for these versions is `config/toolchain-versions.json`; `npm run toolchain:check` fails when active source drifts from it.

## Modernization rules

1. Current application contracts win over recovered v0.482 behavior.
2. Forward-port recovered native source by capability, not by version-number substitution.
3. Official native release builds use pinned/supported compiler families and never auto-download compilers during packaging.
4. Credentials, raw filesystem paths, and Git execution remain behind native workstation boundaries.
5. Git and Git LFS have one workstation authority. Unreal and the renderer are clients.
6. New native services must be least-privilege, loopback-only where applicable, explicitly authenticated, bounded, and observable.
7. A source family becomes authoritative only after build, behavior-parity, security, and runtime certification.
8. Private Desktop release packages must stage and verify the pinned Git/Git LFS runtimes; relying on arbitrary machine PATH state is not a v1 release configuration.
9. Workstation helper binaries are paired to Cluster runtime version/protocol through a generated SHA-256 integrity manifest and are re-verified by Desktop before launch.

## Current reconstruction caveat

The recovered Qt Desktop project intentionally retains its historical `0.482.0` project version until the Desktop/native capability surface is forward-ported and certified. Changing the version string before parity would only make an old binary more confident.
