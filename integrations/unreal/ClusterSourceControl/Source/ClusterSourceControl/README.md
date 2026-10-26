# Cluster Source Control module

`ClusterSourceControl` is a thin Unreal Editor adapter over the authenticated Cluster Workstation SCM protocol. Unreal never owns Git credentials or spawns Git.

## Pass 6 implementation

- Registers provider `Cluster`.
- Targets Unreal Engine 5.8 first.
- Resolves the trusted repository containing the current `.uproject`.
- Maps Workstation file/LFS-lock state into `ISourceControlState`.
- Maps editor operations to Workstation SCM protocol v1.
- Uses Workstation background operations for asynchronous Check In and Sync, with cancellation and completion delivered from provider `Tick()`.
- Implements `ISourceControlRevision` and hydrates state history when `FUpdateStatus::ShouldUpdateHistory()` is set.
- Materializes exact historical file revisions through Workstation for Unreal history/diff surfaces.
- Keeps Git, Git LFS, credentials, repository trust, and long-running execution in Workstation.

## Certification hold

This source still requires an official UE 5.8 compile and two-workstation runtime test before it is certified. The reconstructed source tree must not claim runtime parity merely because the provider is structurally complete.
