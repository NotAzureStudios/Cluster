# Cluster Server: native supervised update executor

**Status: design and safety-contract implementation in progress. NOT enabled in 1.0.3 until verified.**
This document is an implementation contract. Existing signed staging and recovery
primitives are **not** an automatic installer.

## Why an independent owner is mandatory

A downloaded Server installer is staged under `Server/data/system/updates/<channel>`.
The Cluster Installer selects `<directory-of-EXE>/Cluster` as its target.
Launching the staged binary in-place would therefore target the **wrong folder**.
Also, the current Server and its launcher may be using files that the installer
must replace. The API cannot terminate itself and then apply an update.

The new preflight:
- `inspectStagedServerUpdate` re-verifies the pinned Ed25519 signature,
  signed release sequence, same-origin feed, binary SHA-256/size/PE header,
  installed release and managed ownership.
- `prepareSignedServerInstaller` rechecks the publisher signature and
  copies the executable beside the existing managed `Cluster` folder,
  with exclusive create, double digest check and **no execution**.
- `--update-readiness` and native console `update-readiness` are read-only.
  They **never** present a staged artifact as automatically installable.
- The installer `--skip-launch` mode is permitted only for newer embedded
  releases upgrading an existing managed installation.

## Owner and authorization contract

1. Authenticate the operator against the same protected Server Configuration
   permissions and Security PIN as other sensitive Server actions. Require an
   explicit, single-operation **Install this signed release** confirmation.
   No generic shell commands or filesystem paths from the browser.
2. The API creates an exclusive, bounded, fresh request referencing the exact
   signed release, channel, sequence, digest, current config revision and
   unique transaction ID. Do not store the PIN or database URL in the request.
3. Only the trusted native Windows supervisor can claim the request. Reverify
   the installed release and pinned publisher signature **after claiming**.
4. The supervisor launches a separately owned Windows update worker outside
   `Server/`, with explicit local operator elevation if required. A Windows
   Service running as LocalService must never simulate desktop UAC or request
   arbitrary elevated command execution from an HTTP client.
5. Worker must have a durable one-shot lock: a repeated click, crash, outdated
   release, changed configuration or concurrent restart fails closed.

The `claimAuthorizedServerUpdate` helper now implements the native side
of one exact, fresh authorization claim: a strict, bounded file, atomic
`.claimed` rename, server-config SHA-256 check, publisher-signed staged
release + SHA-256 check, and no other update hold or pending restart.
It does **not** itself create an authorization, stop a service, or install
an update. A crashed claim intentionally remains claimed for local recovery.

The currently connected web and native flows **do not** implement the
authenticated update-ticket producer or the independent Windows execution
worker yet. Do not expose an enabled install button before they do.

## Transaction ordering

Use the existing `runServerUpdateTransaction` hook sequence:
1. Confirm native owner authorization and signed candidate again.
2. Persist authorization/start event in the independent update journal.
3. Create `cluster-update-hold.json`. Host and direct API must reject writes.
4. Drain background work and stop only managed Server/Host/PostgreSQL owned
   processes, via Windows Service Control Manager or the interactive owner.
   Verify complete exit and no open file handles before touching binaries.
5. Run a cold snapshot of the stopped PostgreSQL tree using
   `copyColdPostgresSnapshot` and verify it with `verifyColdPostgresSnapshot`.
   Validate free disk space and retained Library/config before proceeding.
6. Prepare executable beside the original managed installation parent with
   `prepareSignedServerInstaller`; run the trusted signed installer with
   `--skip-launch`. Confirm exact release identity and installer rollback
   snapshot. Do not force replace a running service executable.
7. Start candidate through its original service/interactive authority. Probe
   local Host, API, Web, PostgreSQL compatibility, saved network deployment
   and expected release for bounded time. Public DNS/TLS remains separately
   verifiable and must never be invented from a local probe.
8. Persist success evidence and only then release update hold. Once access may
   have reopened, **never roll back the database automatically**.
9. On any earlier failure, stop candidate, verify prior app snapshot,
   restore the cold PostgreSQL snapshot, start old release and prove readiness
   **before** releasing previous hold.
10. If verification or rollback fails, keep the hold, preserve failed candidate
    and snapshot evidence, report blocked recovery and require local operator
    intervention. Never claim a successful update or erase data.

## Durable progress and recovery

- Journal: `<WorkRoot>/UpdateProgress/<transaction-uuid>.jsonl`.
- Each event is one bounded, fsynced `{schema,transactionId,phase,state,updatedAt}`.
  States and phases come from fixed enums. Never persist passwords, access
  tokens, full PostgreSQL URLs or arbitrary exception text in this journal.
- Duplicate transaction IDs fail closed; do not silently overwrite the journal.
- The cold recovery folder lives in `<WorkRoot>/UpdateRecovery/<uuid>/`,
  outside the replaceable application root.
- The installer already keeps a previous application snapshot under
  `<WorkRoot>/Rollback/`; the future owner must bind that specific snapshot
  to the transaction and verify it before using it.
- Browser disconnect is not cancellation of mandatory recovery. A reconnecting
  UI reads native authoritative progress; there must be no client-side timer
  standing in for a server restart result.

## Release criteria

**Automated**:
- Signed update test feed and correctly pinned Ed25519 publisher key.
- Replays, downgrades, bad signature, tampered installer/manifest, wrong
  installer location, source symlink, duplicate journal/hold, and unknown
  transaction inputs are all rejected.
- Mandatory transaction hook order; crash or canceled browser cannot skip
  recovery; failed backup means no installer execution.
- Windows x64 build, first-install smoke, and installer upgrade admission test.

**Live Windows evidence, both launch modes**:
- Existing 1.0.2 → 1.0.3 with real PostgreSQL 18.6, saved Library, accounts
  and Server Configuration survives upgrade.
- User PIN authorization, native UAC where necessary, exact release selection,
  controlled Service/interactive shutdown and one-session reconnect.
- Bad candidate executable, occupied listener port, database unavailable and
  deliberately blocked startup all trigger previous release recovery.
- Failed recovery leaves the hold intact and presents native recovery details.
- No unrelated Node.js/PostgreSQL processes are killed.
- Correct public Cloudflare hostname, Host header checks and TLS tested from
  a remote client independently of localhost readiness.

No in-place upgrade or recovery is certified solely by GitHub source CI.
Do not publish a new 1.0.3 signed feed or claim automatic update capability
until the independently running Windows owner and all relevant tests exist.
