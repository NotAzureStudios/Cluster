# Cluster v1 Integration Foundation

## Launch requirement

Cluster v1 must ship with maintainable source and certified integration paths for the workstation, Unreal Engine source control, and Discord. These are launch requirements rather than post-launch experiments.

## One source-control authority

The workstation owns local Git execution and credentials:

```text
Unreal Editor
  -> Cluster Unreal Source Control Provider
  -> loopback Workstation Source Control protocol
  -> Cluster Desktop / native workstation service
  -> Git + Git LFS + credential broker
```

The Cluster server remains authoritative for studio/project identity and permissions. It may coordinate repository metadata and project policy, but it does not execute arbitrary developer-workstation Git commands.

### Shared protocol

`packages/shared/src/workstation-source-control-contracts.ts` defines the first canonical protocol version and operation vocabulary. Pass 3 adds the first dedicated native Workstation implementation behind that wire contract. It is source-level forward-port work and still requires current-toolchain Windows runtime certification before it replaces the WIP56 native behavioral reference.

### Unreal v1 target

The Unreal plugin must graduate from the Pass 2 scaffold into a registered source-control provider with:

- repository connection/status
- Content Browser/editor file states
- add/delete/revert/check-out style operations
- commit and sync through Desktop
- history and diff where Unreal supports them
- Git LFS lock ownership/acquire/release for binary assets
- useful degraded/offline states when Desktop is unavailable
- version-adaptation isolated so Unreal API changes do not leak through the whole integration

The provider must never store Git credentials or run an independent Git state machine.

## Desktop v1 target

Desktop must become the workstation source-control broker, building on the modern Git renderer/API contracts already present in the current application tree. Required parity includes:

- repository discovery/attach/clone
- status/details/diff/history
- branch/tag/upstream/remotes
- stage/unstage/commit/amend
- fetch/pull/push
- conflict workflows
- stash/merge/rebase/cherry-pick/revert/reset
- `.gitignore` / `.gitattributes` and Git LFS policy
- LFS health and lock management
- secret scanning / repository trust boundaries
- cancellable long-running operations and progress
- native notifications and reliable offline/reconnect behavior

Recovered Qt/C++ source is not considered parity-complete until those modern Workstation/Git capabilities are implemented and compared against the current WIP56 native behavioral reference.

## Discord v1 target

Discord is a controlled projection and action surface. Cluster remains the source of truth.

Pass 3 establishes:

- `/cluster status` and `/cluster help`
- permission-checked `Create Cluster Ticket` message-context handling
- linked Discord identity -> Cluster user authorization
- Project/channel route bindings and outbound delivery evidence
- durable inbound interaction receipts for idempotency
- a transport-only Gateway relay using zero privileged intents
- a separate authenticated relay secret between the sidecar and Cluster

Before v1 certification, the integration still requires:

- Discord account linking -> immutable Cluster user identity
- guild -> Cluster workspace binding
- channel -> project/event subscription mapping
- authorization performed by Cluster for every protected command
- service-account/scoped integration authority
- delivery/retry/dead-letter handling for outbound notifications
- audit evidence for inbound writes
- no Security PIN, password, passkey, or recovery secret collection through Discord

Planned command families include Projects, Tickets, Builds, QA, Calendar, and studio status. Message-to-Ticket creation must preserve the source message URL/context without granting Discord broader Cluster authority.

## Hard v1 integration gates

### Unreal gate

On two clean workstations, connect the same Unreal project through Cluster Desktop; lock and modify a binary asset, verify lock ownership in both editors, commit/push from one workstation, sync on the other, and confirm Desktop, Unreal, and Cluster agree on repository state.

### Desktop gate

Clone a Cluster Unreal project on a clean workstation; apply recommended LFS policy; work offline; reconnect; exercise a real conflict; resolve, commit, and push without needing a separate Git GUI.

### Discord gate

Connect a clean Discord guild, link a user, bind a project channel, create a Ticket from a message, receive a build notification, prove an unauthorized user cannot read the project, revoke the linked user's Cluster access, and verify Discord access disappears with it.

## WIP57 Pass 4 Unreal provider boundary

The Unreal integration now implements and registers `ISourceControlProvider` in source. Its state and operation adapters are backed by the authenticated Desktop Workstation protocol, including trusted repository resolution, clean/dirty file-state projection, and LFS lock ownership.

This does **not** close the Unreal v1 gate by itself. The provider must compile against the supported Unreal Engine 5.8 toolchain and pass the two-workstation binary-asset lock/commit/sync test before it is considered certified. Revision/history/diff adapters and asynchronous long-running operation handling remain follow-on provider work after the first real engine compile verifies the API surface.

## WIP57 Pass 5 Workstation capability promotion

The Workstation SCM boundary now provides repository-scoped asynchronous operation lifecycle (`start`, `status`, `cancel`), path-aware history, and validated revision-aware diff. This is the intended substrate for Unreal asynchronous workers and `ISourceControlRevision`/diff integration.

The Unreal provider remains the editor adapter, not the Git executor. Pass 5 therefore does not add direct Git process calls to the plugin. The next provider layer should translate Unreal async operation workers and revision objects onto these Workstation capabilities, then certify them in a real Unreal Engine 5.8 build.

Discord v1 work remains server-authoritative. Delivery diagnostics now distinguish retrying from dead-letter failures and retain admin-authorized durable manual retry. Runtime guild/account/channel authorization and delivery behavior still require live Discord certification.

## WIP57 Pass 6 Unreal async / revision promotion

The Unreal provider now consumes the Workstation background-operation lifecycle for long-running source-control work and owns a concrete `ISourceControlRevision` implementation backed by Workstation history/materialization. The editor remains an adapter only: it neither stores Git credentials nor starts Git processes.

`revision.materialize` is intentionally workstation-owned. It validates revision/path input, materializes the requested Git object into the protected local revision cache, and returns the cache path to Unreal for the engine's revision/diff surfaces.

Qt Desktop also has a canonical authenticated source-control action bridge to the same Workstation protocol. This is the convergence point for future native Desktop Git UI rather than another native-only Git transport.

The supported Unreal Engine 5.8 provider surface now includes the current `FInitResult Init(EInitFlags)` initialization path in addition to legacy initialization, but UE 5.8 compilation and runtime testing remain mandatory before certification.



## WIP57 Pass 7 Desktop operation feed + Discord lifecycle hardening

Desktop source-control parity now uses the existing shared React Desktop workspace rather than introducing a second QML Git interface. The recovered Qt host monitors Workstation Git operations asynchronously **only while active work exists**, publishes `workstation.operations.changed` events into the native capability bridge, and stops polling when operations reach terminal state. The renderer keeps only slow safety reconciliation for helper restarts or operations initiated by another local client such as Unreal.

Workstation operation records now publish meaningful stages for clone, fetch, pull, push, LFS work, staging, commit, and finalization rather than a generic running state. This remains one authority: Workstation owns Git execution; Qt and Unreal consume its protocol.

Discord runtime hardening now rejects suspended, disabled, non-active, or expired linked Cluster accounts before protected Discord actions proceed, and channel routing refuses archived Projects. The Gateway relay supports a temporary server-side previous relay token for safe secret rotation while still using timing-safe comparison. `CLUSTER_DISCORD_RELAY_TOKEN_PREVIOUS` is a rotation aid only and must be removed after the new current token is confirmed.

These changes improve source readiness but do not replace the live Discord guild, official Qt/Go, Windows lifecycle/DPI, or Unreal 5.8 certification gates.


## WIP57 Pass 8 packaged source-control runtime boundary

The Desktop v1 gate now explicitly includes the Git runtime itself. Workstation prefers a private packaged Git runtime and a private Git LFS runtime; relying on an arbitrary system installation is allowed only as a development/recovery fallback. Windows release packaging must stage and verify the pinned runtimes before Qt packaging succeeds.

Workstation/Qt pairing is also version-fenced: the helper build manifest carries the Cluster runtime version, source-control protocol, Go toolchain identity, sizes, and SHA-256 hashes. Qt refuses mismatched helper manifests and re-verifies the helper hash before launch. Discovery records from a different runtime version/protocol are not accepted, and existing endpoints are health-probed before reuse.

This is still source readiness, not the final v1 integration certificate. A clean Windows workstation must prove that the bundled Git/Git LFS path works with no system Git installed, then complete the Unreal two-workstation lock/commit/sync gate.
