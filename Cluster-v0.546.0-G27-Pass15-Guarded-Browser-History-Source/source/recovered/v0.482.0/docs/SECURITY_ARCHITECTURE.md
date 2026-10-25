# Cluster security architecture

Cluster treats the browser, native desktop host, managed web gateway, private API process, and PostgreSQL runtime as separate trust boundaries. Security controls are layered so a failure in one surface does not automatically become native-code or database access.

## Security defaults

- Authentication is required in production profiles.
- Remote managed-host access requires an explicit public origin and TLS unless the administrator deliberately enables insecure HTTP.
- Session cookies are HttpOnly, SameSite=Strict, Secure whenever TLS is active, and server-side sessions are stored by token hash rather than raw token.
- Mutating API requests are origin-checked and cross-site requests are rejected.
- API responses are non-cacheable by default. Authenticated media may use private revalidation but is never service-worker cached.
- Executable uploads are disabled by default. Upload destinations are constrained to Cluster's data root and image uploads are content-checked rather than trusting filename extensions.
- Browser pages receive a restrictive CSP, frame denial, MIME sniffing protection, referrer restrictions, permissions policy, COOP/CORP, and HSTS on HTTPS.
- The managed Go gateway rejects unexpected Host headers, strips untrusted forwarding headers, and only serves static UI content for GET/HEAD.

## Web client boundary

The browser client receives application data through same-origin `/api/` requests. Authentication tokens are not stored in localStorage or JavaScript-readable storage; the browser carries the HttpOnly session cookie.

The service worker caches only same-origin application shell assets. It explicitly excludes `/api/`, `/health`, and `/host/` and does not cache `no-store` requests. This keeps offline shell caching separate from authenticated server responses.

The HTML entry point contains no inline JavaScript. Initial theme selection runs from the bundled application code so the managed gateway can enforce `script-src 'self'`.

## Native desktop boundary

The Windows desktop host uses the same server-hosted React renderer through Qt WebView/WebView2. The WebView is treated as untrusted web content even though it is Cluster-owned:

- JavaScript and local storage are enabled because the renderer requires them.
- `file://` access and local-content file access are disabled.
- Navigation is confined to the active Cluster server origin. External HTTP(S) and mail links are handed to the operating system instead of being loaded inside Cluster.
- Remote Cluster profiles require HTTPS by default. Plain HTTP is accepted only for localhost/loopback development unless `CLUSTER_DESKTOP_ALLOW_INSECURE_HTTP=1` is deliberately set for development.
- The WebView host runs as the normal user, never as an elevated/admin browser host.

### Per-server browser and native-data isolation

Each saved Cluster server receives two validated local containers under the user's Cluster application-data directory: a WebView2 user-data folder for browser-managed cookies, IndexedDB/DOM storage, permissions, and browser cache, plus a native profile folder for the Qt API HTTP cache, DPAPI-protected native API session persistence on Windows, offline mutation data, resumable-transfer metadata, and the local search index. State from one server profile therefore does not share a local persistence container with another.

The native profile registry stores only bounded server/profile metadata: normalized URL, local display label, non-secret studio/user display labels, timestamps, last renderer route, and recovery counters. It does **not** copy passwords, session cookies, bearer tokens, authorization headers, or other authentication secrets out of WebView2.

Profile lifecycle is managed independently for each server. Switching profiles restarts the small Qt shell so WebView2 can be initialized against the target server's data folder before any renderer content loads, while the native API/offline subsystems are pointed at the matching native profile directory before their scopes load. Active sign-out performs the server-side `/api/auth/logout` request inside the same-origin WebView context and then resets that server's browser and native containers; the HttpOnly WebView cookie is never surfaced to Qt. Inactive-profile sign-out is deliberately local-only because there is no live browser context from which to revoke that server session safely.

A full profile reset deletes both validated per-server containers. That clears WebView cookies/cache/IndexedDB/local storage/permissions plus the native API HTTP cache, encrypted native API cookie vault, offline mutation queue, resumable-transfer metadata, and local search index for that server without affecting other profiles. Active resets use a pending-delete marker plus a controlled shell restart so the old WebView2 process can release its directory before both containers are deleted and recreated empty.

Cluster also tracks profile-scoped renderer health without recording sensitive page data. Successful loads, consecutive failures, the last bounded error string, and unclean process-session markers are used only to identify a profile that may need recovery. Repeated failures surface the native server manager, where the user can clear the warning or reset only that profile.

Profile folder identifiers are deterministic SHA-256-derived IDs from the normalized server origin. Persisted IDs are never trusted as filesystem paths. Before clearing or deleting a profile, Cluster validates that the browser target remains underneath the Cluster WebView2 root and the native target remains underneath the Cluster native-profile root. This protects profile-management actions from path traversal even if the local registry is manually modified.

WebView2 user-data-folder ACLs are left to Windows/WebView2. Cluster does not tighten or rewrite them because doing so can break WebView2's Low Integrity/AppContainer sandbox processes.

The native Windows API cookie vault is stored inside the active native profile and encrypted with DPAPI entropy that includes the server profile ID. Legacy origin-keyed QSettings ciphertext is migrated once and removed. See `docs/DESKTOP_SERVER_PROFILE_ISOLATION.md` for the complete lifecycle and migration boundary.

## Native capability broker

Cluster Desktop exposes a deliberately small renderer-to-native protocol rather than a general JavaScript-to-C++ object. The renderer queues versioned JSON requests, the Qt host polls only while the active WebView is on the active Cluster server origin, and `NativeCapabilityBroker` validates the request again before dispatch. Requests are schema-checked, bounded to 16 KiB, rate-limited, replay-protected by request ID, and audited without recording local paths or secrets.

The v1 allowlist is intentionally narrow:

- runtime information;
- user-mediated file and directory pickers;
- opening or revealing an item previously selected through a native picker;
- bounded native notifications;
- opening the native app-settings or server-profile windows;
- requesting a renderer reload.

There is no capability for arbitrary process execution, shell commands, arbitrary filesystem reads/writes, credential retrieval, screen capture, unrestricted network requests, or generic IPC. Adding a new capability requires an explicit protocol name, input schema, output schema, rate/size limits, and a security review.

### Opaque local handles

Native pickers never return a local filesystem path to the renderer. A user-selected file or directory receives a random `fh-...` handle held only in native process memory. The renderer sees the handle plus bounded display metadata such as name, type, size, MIME type, and expiry. Handles are scoped to the active server profile, expire after 30 minutes, are capped in number, and are revalidated against the filesystem immediately before use.

`file.open` and `file.reveal` accept only a live native handle. Supplying `C:\...`, `/home/...`, UNC paths, traversal strings, or a handle issued under a different Cluster server profile does not grant access. This keeps an XSS or compromised renderer from turning the desktop host into an arbitrary filesystem browser.

Native file dialogs are themselves user-mediated and have a separate low request-rate ceiling to limit dialog-spam denial of service. Notifications have an independent rate limit and respect the user's desktop-notification preference.

### Renderer transport

The transport is a bounded request/response queue (`__clusterNativeRequests` / `__clusterNativeDeliver`) created only when Cluster is loaded with the desktop-host marker. Qt polls at a short interval while the renderer is healthy and same-origin, processes at most eight requests per pump, and returns only validated JSON responses. A compatibility `window.clusterDesktop` object is installed by the renderer, but it contains only methods backed by the allowlisted broker. Historical process, credential, capture, and unrestricted file-path APIs are not installed by the Qt host.

The existing desktop-state channel remains native-pull-only and separate from the command broker. It contains only schema version, unread notification count, active screen, bounded server/user display labels, and active project identifiers. Authentication cookies, bearer tokens, passwords, email addresses, native file paths, and command arguments are not copied into Qt state.

Desktop-native responsibilities include process lifecycle, tray integration, OS notifications, signed updates, deep links, user-mediated local access, per-server profile isolation, and local diagnostics. Core workspace authorization remains server-side; the desktop host is never treated as a trusted bypass around API permissions.

## Server/API boundary

The public managed host and private Node API are separate processes. The Go gateway is the public browser-facing surface. In managed-host mode the Node API is private/loopback and receives controlled forwarding metadata from the gateway.

The API applies:

- strict CORS origin allowlisting with an explicit method/header surface;
- origin checks for state-changing API requests;
- fixed-window rate limiting with stricter authentication limits;
- Argon2id password hashing with a safe fallback implementation where required by the runtime;
- constant-work/dummy-password verification paths to reduce account-enumeration timing differences;
- random 256-bit session tokens stored only as hashes in PostgreSQL;
- idle expiry, absolute expiry, per-user session limits, revocation, and security-event audit telemetry;
- request IDs and redacted error logging rather than echoing secrets;
- executable-upload blocking and file-content checks;
- PostgreSQL-only persistence with migrations and startup schema verification.

## Update and supply-chain boundary

Dependency versions are centralized in `config/toolchain-versions.json`. Dependabot and the scheduled dependency monitor propose updates, while build/test gates decide whether they are safe to merge. Patch updates may be automated only after CI; major dependency changes require an explicit migration review.

Desktop updates use a protocol-1 Ed25519-signed manifest plus exact SHA-256 and byte-size metadata. The native host enforces same-origin update redirects and artifact URLs, validates resumed ranges, and repeats artifact verification immediately before installer execution. Installer releases must include a verified rollback installer for the currently installed version.

Desktop installation is transactional. Previous/target version and non-secret rollback metadata are persisted before installer launch; the new runtime enters an `awaiting-health` state and retains rollback until renderer/native runtime health is confirmed. Repeated early exits surface `rollback-ready`, and rollback re-verifies the retained installer before it can run. See `docs/DESKTOP_UPDATE_SECURITY.md`.

## Operational guidance

Use HTTPS for every remotely reachable Cluster server. Keep the WebView2 host and server processes non-elevated unless a dedicated maintenance action genuinely requires elevation. Preserve private runtime/data directories during upgrades, maintain tested backups, and review audit/security events rather than disabling controls to make an error disappear.


## Authentication and session hardening (v0.349.0)

Authenticated unsafe API requests pass the shared origin/Fetch Metadata boundary and a session-bound HMAC CSRF check before route handlers run. Direct HTTPS uses an HttpOnly, Secure, SameSite=Strict `__Host-cluster_session` cookie; managed-host loopback keeps the unprefixed cookie because the private API terminates behind the Go host.

High-risk administrator and session-management mutations require recent password confirmation. Reauthentication rotates the session instead of merely setting a client-side flag. The React renderer owns the password prompt; Qt never receives the password, CSRF token, or session cookie. See `docs/AUTH_SESSION_SECURITY.md` for the full policy.

## Central authorization boundary

Application authorization is enforced server-side before protected route handlers execute. The centralized request policy combines method-aware tool permissions with authoritative object-level resolution, project/access-rule checks, user ownership rules, and administrative fail-closed boundaries. UI visibility is never treated as authorization.

Child IDs are resolved to their real PostgreSQL parent before access is evaluated, so a caller cannot pair an allowed project ID with an object from another project. Alias routes retain the protected resource's capability, including Tickets enforcement through generic board/card/checklist APIs. Collection endpoints filter rows with the same object-level policy before serialization or aggregation, and create/update operations authorize the proposed destination before re-parenting.

See `docs/AUTHORIZATION_ARCHITECTURE.md` for the capability/resource model, user-scope rules, alias handling, and regression requirements.

## Upload and untrusted-content boundary

Uploaded bytes are not trusted based on browser MIME declarations, filenames, extensions, desktop metadata, or persisted database MIME values. Base64 uploads are decoded canonically under a decoded-byte ceiling, file identity is derived server-side from signatures/conservative text inspection, executable payloads remain policy-gated, and resolved destinations must stay under Cluster-managed data storage.

Active same-origin content such as HTML, SVG, XML, JavaScript, CSS, MHTML, and HTA is forced to attachment disposition and receives `nosniff` plus a restrictive sandbox policy. Only a narrow passive set is eligible for inline display. Desktop transfer staging adds per-user session/byte quotas, free-space reserve, exact range/size validation, repeated SHA-256 verification, atomic attachment, and post-attach cleanup. Built-in Blender preview conversion has hard source, companion, and output ceilings.

See `docs/UPLOAD_CONTENT_SECURITY.md` for the full file-identity, serving, staging, preview-conversion, and malware-scanning boundary.

## Outbound network and integration boundary

Server-initiated HTTP uses a bounded DNS-pinned client rather than unrestricted platform `fetch()`. HTTPS is the default, resolved addresses are classified before connection, the validated address is pinned into the socket lookup, response/request sizes are capped, redirect destinations are revalidated, and cross-origin redirects are rejected. Fixed public integrations such as Discord additionally use hostname allowlists.

Self-hosted Git is the only current integration with an explicit private-network exception. Administrators must deliberately enable private/LAN Git access; plain HTTP is accepted only when the pinned destination is actually private. Link-local and metadata-style ranges remain blocked even with that exception. See `docs/OUTBOUND_NETWORK_SECURITY.md`.

## Secret and configuration custody boundary

Integration credentials are database-only authenticated ciphertext, while the small set of secrets required before PostgreSQL is available may exist in the boot configuration only as authenticated ciphertext. Production requires a dedicated `CLUSTER_SECRET_KEY` that is independent from session/authentication secrets; encryption never falls back to those keys in production. Legacy/plaintext protected values are migration inputs, not valid steady-state storage.

Cluster masks protected settings in API responses, applies recent-authentication requirements to privileged configuration and secret-bearing context-pack exports, redacts known secret fields from request logs, and excludes environment/private-key artifacts from release packages. Backups contain encrypted data but **never** the storage key, so disaster recovery requires the matching key to be preserved separately. See `docs/SECRET_CONFIGURATION_SECURITY.md` for storage classes, key rotation, migration, backup recovery, and non-goals.

## API abuse and resource-exhaustion boundary

Cluster treats request cost, request size, and concurrent expensive work as separate controls. General API budgets are weighted by route purpose, heavy and critical operations have independent per-client/global in-flight ceilings, and route-specific body limits are enforced before parsing for both declared and chunked payloads. Backpressure is retryable and is applied only after the normal authentication/authorization boundary. See `docs/API_ABUSE_RESOURCE_SECURITY.md`.

## Security audit and evidence boundary

Security-sensitive events are recorded in the server-owned `SecurityAuditEvent` trail rather than relying on the user-facing activity feed. Starting with v0.355.0, new security events are serialized through a PostgreSQL advisory-lock append path and linked with ordered SHA-256 hashes over the stored actor, target, request, result, metadata, timestamp, and previous-hash fields. Existing pre-v0.355 events remain legacy history and are not falsely presented as retroactively tamper-evident.

Generic retention no longer removes security-chain rows. Administrative diagnostics can perform a full chain verification, security exports are bounded and digest-labeled, metadata is redacted before persistence, and privileged request outcomes are captured centrally in addition to explicit authentication/security events. Audit write failures are surfaced as security telemetry instead of being swallowed as harmless logging errors. See `docs/SECURITY_AUDIT_TRAIL.md`.


## Mutation and data-integrity boundary

Cluster v0.357 uses durable pre-execution idempotency claims for eligible authenticated API mutations. Official clients generate a mutation key before the first network attempt and preserve it across offline queuing/replay. Concurrent duplicates cannot both acquire the database uniqueness claim, completed responses can be replayed, and crash-ambiguous results fail closed as `IDEMPOTENCY_RESULT_UNKNOWN`. Revisioned collaborative resources use compare-and-swap writes, and destructive sync tombstones are committed in the same transaction as the revision-checked delete. See `MUTATION_DATA_INTEGRITY.md`.

## Offline synchronization integrity boundary

Cluster v0.358 treats offline synchronization as a continuation of the authenticated API boundary rather than a privileged transport. Core and Library delta cursors are HMAC-authenticated and bound to the user plus a digest of the current authorization scope. A scope change invalidates Cluster-managed durable read caches while preserving queued writes/uploads, and delta records are filtered with the same target/tool authorization semantics used by normal routes.

Offline mutation replay accepts only canonical allowlisted API paths and safe concurrency headers, rejects secret-shaped payloads, and executes through the original Fastify routes. Step 11 `ApiMutationReceipt` records remain the single durable idempotency authority. Sync control state is PostgreSQL/Prisma-only, device identities are account-scoped, and cursor paging cannot skip an authorized record merely because filtering reduced a page. See `docs/SYNC_INTEGRITY_SECURITY.md`.

## Database recovery and backup resilience boundary

Cluster v0.359 treats a recoverable server as PostgreSQL **plus** the authoritative file assets that PostgreSQL references. New schema-v2 backup generations therefore commit a PostgreSQL custom-format dump, uploaded project/media files, branding assets, and protected boot configuration under a portable signed manifest. The manifest is committed last, uses relative artifact names, records source schema/count metadata, and is HMAC-authenticated with the separately preserved Cluster secret key. Partial generations do not count as successful scheduled backups and stale orphan artifacts are cleaned independently from committed-generation retention.

Startup refuses PostgreSQL recovery/read-only replicas because Cluster requires a writable primary. Restore drills now restore the database into a disposable PostgreSQL database and extract file archives into disposable recovery roots before comparing migrations/content metadata. This is a recovery-readiness boundary, not a claim of WAL/PITR or a transactionally atomic database+filesystem snapshot under live writes; operators still need off-host copies and separately protected recovery keys. See `docs/DATABASE_RECOVERY_RESILIENCE.md`.

## Operational health and failure-containment boundary

Cluster v0.360 separates process liveness from traffic readiness. `/health/live` proves only that the process/event loop can answer HTTP, while `/health/ready` additionally requires completed startup, a non-draining lifecycle, PostgreSQL readiness, and real write/delete access to critical Cluster storage. Expensive runtime detail remains administrator-only.

Runtime telemetry, background-task failure streaks, dependency probes, and lifecycle state are combined into a bounded operational state model (`starting`, `healthy`, `degraded`, `unavailable`, `draining`). Background automation does not begin until bootstrap and readiness checks succeed, and draining rejects new application work while existing connections close under the configured deadline. See `docs/OPERATIONAL_HEALTH_RESILIENCE.md`.


## Release certification and supply-chain boundary

Cluster v0.361 treats release certification as a security boundary. Production certification is bound to one immutable source revision, complete dependency-lock/SBOM inventory, database/integration/upgrade/restore evidence, native build evidence, and signed desktop smoke evidence. Public distribution additionally requires verified Authenticode signatures for Windows payloads and the installer. The final Master carries a hash-checked certification ledger and evidence bundle; local archives without those guarantees remain explicitly unattested. See `RELEASE_CERTIFICATION_SUPPLY_CHAIN.md`.

## Privacy consent and browser-storage boundary

Cluster v0.363 separates storage that is required to operate the product from optional browser preferences and external content. The session cookie, offline/sync state, recovery drafts, short-lived navigation state, and the consent record itself are treated as necessary. Theme/sidebar/media/search personalization is optional preference storage, and YouTube privacy-enhanced embeds are optional external content. Cluster currently declares no third-party behavioral analytics providers.

Optional preference helpers fail closed until the current consent notice has been reviewed. Withdrawing preference consent purges only the declared optional keys and never clears pending offline mutations, uploads, sync identity, or recovery drafts. External iframes are not created before consent and are unmounted when external-content consent is revoked. The public storage inventory is available at `/api/public/privacy/consent-config`; authenticated user choices are synchronized through `/api/privacy/consent`. See `docs/PRIVACY_CONSENT_STORAGE.md`.


## Privacy self-service data boundary

Cluster v0.364 adds an account-scoped Privacy & Data Control Center. Self-service summary/export/request routes derive the target account exclusively from the authenticated session and do not accept a caller-supplied user ID. Personal-data exports require recent authentication, are bounded per record category, use no-store responses, exclude credential hashes/token hashes/server secrets/raw security evidence, and record the export in the tamper-evident security trail.

Account-data deletion is request-based rather than an immediate cascade so studio/legal retention, security evidence, project ownership, and backup policy can be handled deliberately. Optional Discord identity removal is also recent-authenticated; it is blocked when the studio requires Discord and revokes active sessions when performed. See `docs/PRIVACY_DATA_CONTROL_CENTER.md`.

## Data inventory and retention boundary

Cluster v0.365 centralizes operational data retention under explicit `DataRetentionPolicy` rows and an administrator dry-run/apply workflow. Only bounded operational categories can be age-pruned. Security audit-chain evidence, legal-policy history, privacy-request evidence, authoritative project/work records, and authoritative uploads are excluded from unattended retention. Backup generations, mutation receipts, and desktop transfer staging keep their existing safety-specific lifecycle rules and are surfaced as delegated inventory. Scheduled operational maintenance consumes the same policy engine as the Studio Settings UI, and retention changes/runs are protected by administrator authorization, recent authentication, explicit confirmation, and the security audit trail. See `docs/DATA_INVENTORY_RETENTION.md`.

## Versioned Terms publication boundary

Cluster v0.366 extends the immutable legal-policy store with a `terms` document kind. Public Terms reads expose only the currently effective published version, while draft creation/editing/publication stays behind the administrator and recent-authentication boundaries. Published Terms are SHA-256 hash-addressed and immutable, future effective dates are supported, and the starter Terms text is never auto-published. The public renderer remains Markdown-only with no raw HTML injection path. Publication still does not equal acceptance. Roadmap Step 17 in v0.378.0 adds an explicit version/content-hash-bound acceptance boundary; see `docs/AUDITABLE_POLICY_ACCEPTANCE.md`. See `docs/TERMS_OF_SERVICE_SYSTEM.md`.


## Server Operator Agreement

Cluster v0.367 adds a separate `operator_agreement` legal-policy kind for the deployment operator relationship. It reuses immutable hash-addressed `LegalPolicyVersion` records, public effective-version reads, and administrator/recent-authenticated publication. It remains separate from ordinary user Terms. Roadmap Step 17 in v0.378.0 can independently require and record acceptance evidence for an Operator Agreement version. See `docs/SERVER_OPERATOR_AGREEMENT.md`.


## Copyright / DMCA publication boundary (v0.368.0)

Cluster v0.368 adds a separate `copyright_dmca` immutable legal-policy kind. The public policy can document the operator's copyright contact and, where applicable, designated-agent/notice/counter-notice process, but Cluster does not claim that publishing the page creates § 512 safe-harbor eligibility or completes Copyright Office agent registration. The starter document is never automatically published, published revisions are SHA-256 hash-addressed and immutable, and the public renderer remains restricted Markdown. Structured notice/counter-notice case handling is implemented in roadmap Step 8 and documented in `docs/COPYRIGHT_REPORTING_WORKFLOW.md`. See `docs/COPYRIGHT_DMCA_POLICY.md`.


## Copyright reporting workflow boundary

Cluster v0.369 adds public notice intake, private tokenized reporter status, authenticated counter-notices, bounded evidence storage, reversible resource restrictions, restoration/legal-hold deadlines, repeat-infringer review history, and administrator case actions. Normal file/video/Library serving paths enforce copyright restrictions server-side with HTTP 451. See `docs/COPYRIGHT_REPORTING_WORKFLOW.md`.


## Logout, revocation, and captured-session replay boundary (v0.374.0)

Cluster v0.374 treats logout and session revocation as server-authoritative lifecycle events rather than renderer navigation. Revoked, expired, idle-timed-out, password-reset, account-disabled, and identity-rotated sessions are rejected by the normal database-backed session lookup even when a client replays a previously captured cookie or CSRF value. Logout and explicit session-management actions also publish security-audit evidence.

Realtime collaboration streams are bound to the exact authenticated session that opened them. Revoking one session closes that session's streams and removes its presence without terminating unrelated valid sessions for the same account; deliberate reauthentication rotation emits a reconnect state instead of being misclassified as logout. The renderer treats protected `401 AUTH_REQUIRED` responses and explicit sign-out/session-revocation results as an authenticated-state invalidation event: in-memory query data and account-scoped durable read caches are purged, while pending offline mutations and uploads are preserved for deliberate reconciliation rather than destroyed. Native active sign-out still performs the same-origin server logout inside WebView2 before resetting only that server profile. See `docs/LOGOUT_SESSION_REPLAY_REGRESSION.md`.


## Public vulnerability-disclosure boundary (v0.375.0)

Cluster v0.375.0 adds an operator-owned, immutable Security & Vulnerability Disclosure Policy with public pre-auth access and an RFC 9116-style `/.well-known/security.txt` record. The policy and structured disclosure metadata are hashed together, publication remains an administrator/recent-authentication mutation, and the managed public gateway proxies the security.txt path to the authoritative API rather than serving an unrelated static file. Scope and safe-harbor text remain operator/legal decisions; the starter does not grant blanket testing authorization or create a bug bounty. See `docs/SECURITY_VULNERABILITY_DISCLOSURE_POLICY.md`.
