# Cluster Source Control for Unreal Engine

Cluster's Unreal Engine integration is a real `ISourceControlProvider` implementation backed by the local Cluster Desktop Workstation SCM service.

## Authority

Unreal **does not run an independent Git implementation**. The v1 path is:

`Unreal Editor -> Cluster Source Control Provider -> Cluster Desktop Workstation SCM service -> Git / Git LFS`

Desktop Workstation owns repository execution, credentials, Git LFS, lock ownership, long-running operations, revision materialization, and offline/reconnect behavior. Unreal translates editor source-control operations into the canonical workstation protocol in `packages/shared/src/workstation-source-control-contracts.ts`.

## WIP57 Pass 6 source status

Implemented in source:

- real `ISourceControlProvider` registration and UE 5.8 interface adaptation;
- authenticated ephemeral-loopback Workstation discovery;
- trusted repository resolution from the active `.uproject`;
- file-state and Git LFS lock projection;
- Connect, Update Status, Add, Delete, Revert, Check Out, Check In, and Sync;
- asynchronous Check In / Sync backed by Workstation `operation.start/status/cancel`;
- provider cancellation and editor-safe completion through `Tick()`;
- `ISourceControlRevision` implementation;
- path-scoped history hydration when `FUpdateStatus::ShouldUpdateHistory()` is requested;
- exact Git revision materialization through Workstation's protected revision cache;
- revision retrieval suitable for Unreal asset diff/history surfaces;
- no Git credentials, direct Git processes, or independent repository authority in Unreal.

The Workstation revision cache contains only explicitly requested historical file materializations and does not expose repository roots through the source-control runtime contract.

## Certification boundary

The provider is **not yet UE 5.8 compile/runtime certified** because this reconstruction environment does not contain an Unreal Engine 5.8 toolchain/editor installation. Static/source validation is not a substitute for that gate.

Before v1 certification, build and exercise this plugin against the official supported UE 5.8 toolchain and verify:

1. provider registration and selection;
2. repository discovery from `.uproject`;
3. state overlays for clean/modified/added/deleted/conflicted assets;
4. two-workstation `.uasset` / `.umap` LFS locks;
5. add/delete/revert/check-in/sync;
6. asynchronous progress/completion and cancellation;
7. history population from Update Status with history enabled;
8. revision materialization and Unreal asset diff;
9. Desktop-offline/reconnect and incompatible-protocol recovery;
10. 100%, 125%, and 150% Windows DPI behavior.

## Remaining provider work after compile certification

- improve user-facing progress detail beyond Workstation's current coarse operation stages;
- exercise revision numbering/history behavior against Unreal's History and Diff UI;
- add optional Cluster Project/Ticket/build context surfaces without making them source-control authority.

Provider-specific engine adaptation stays in this plugin. Cluster's generic Workstation protocol must not become Unreal-shaped.
