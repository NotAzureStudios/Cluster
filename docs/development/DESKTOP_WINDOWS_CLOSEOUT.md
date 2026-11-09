# Native Qt Desktop Windows closeout and certification

This is a **live-machine acceptance plan**, not a claim that the Desktop has been installed or tested on the studio workstation. Cluster Server and native Qt Desktop have independent versions and update manifests. The latest GitHub suite release is an artifact source, not proof of installed Desktop health.

## Source gates (automated)

- Documentation and link regressions keep the Server and Desktop release downloads evergreen.
- Native direct-download admission is Qt-independent and rejects redirects, HTTP 206, partial/truncated bodies, failed transport and failed disk writes.
- Native direct-download implementation must read at most 64 KiB per chunk, write through \`QSaveFile\`, preserve at most a small error preview and avoid final publication after failure.
- Profile switching must preserve the old active selection when registry persistence or detached restart fails.
- The separate Desktop updater must reject Server update manifests and respect independent signed Desktop channels.
- A passing Linux policy test or shared Web build does **not** establish that the Qt Windows application compiled.

## Required Windows matrix

| Area | Exercise | Pass criteria |
| --- | --- | --- |
| Fresh install | Download the current Desktop installer, verify the same release's Desktop receipt, install as a standard user | Desktop launches, tray and profile chooser open; no Server/database bundled |
| Portable | Extract the complete Desktop ZIP to a clean folder and launch | Runtime dependencies load, settings and Server profiles are isolated as intended |
| Profile switch | Switch between two distinct Server origins with different accounts | A restart occurs; WebView2, API cookies, Library mount and transfer journal cannot cross profiles |
| Switch failure | Simulate an inaccessible profile-registry directory and a failed detached restart | No in-memory/on-disk active-profile split; an actionable error is presented |
| Download happy path | Download a tiny file and at least one large binary resource | Correct final bytes and checksum; no whole-body RAM spike; no previous file overwritten |
| Download failure | Return 3xx, 206, 401/403, truncated 200, wrong Content-Length, disconnect and disk-full | No incomplete final file; temporary file discarded; useful error shown |
| Resume | Pause/retry an upload and range download across network loss and app restart | Offset, total, validator and checksum agree; no duplicated uploads or appended corruption |
| Session and version | Change Server compatibility state, force expired authentication and retry after temporary outage | Unsafe writes blocked, no cross-server authentication reuse and bounded background retries |
| Update | Exercise an authorized Desktop-only signed manifest, unavailable feed, wrong product, interrupted artifact and verification failure | No bypass, no Server artifact accepted, no unverified file installed |
| Upgrade and rollback | Install candidate on a backed-up Windows profile and roll back after a simulated failed launch | Profiles, local transfer recovery evidence and account data survive |

Measure idle CPU, disk and network request activity, simultaneous transfers and peak resident memory under matched workloads. Collect redacted logs and the exact Server, Qt Desktop and Windows versions. Verify signing and SHA-256 separately.

**Release gate:** Do not merge and distribute Desktop code solely because CI source gates pass. Build an independent Qt Windows installer/portable candidate with pinned Qt 6.11.2, then execute the Windows matrix and review failures. No populated Server database migrations are authorized by Desktop certification.
