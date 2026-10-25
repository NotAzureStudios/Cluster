# RC17 Windows Runtime Test Checklist

Use a fresh RC17 WIP folder when practical. Preserve the complete log/video if any gate fails.

## 1. Immediate compile-blocker gate

- Launch `ClusterServer.exe`.
- Private runtime/bootstrap may reuse already-downloaded Node.js/PostgreSQL if you intentionally copy only the release application into the existing test workspace; otherwise test from a fresh folder.
- Confirm Prisma generation completes.
- **Confirm `npm run build:server` gets past Studio Offboarding with no TS2305 for `syncProjectMembershipProjection`.**
- If another compiler error appears, preserve the full compiler output. That remains RC17 work.

## 2. Bootstrap and setup

- Confirm server and web build complete.
- Confirm migrations deploy and private PostgreSQL starts cleanly.
- Complete first-run setup and sign in.
- Confirm the server reaches Healthy rather than immediately entering Degraded.
- Run Database Doctor from the control panel.

## 3. Original runtime blockers

- Create a project and verify `POST /api/projects/provision` succeeds.
- Open People and My Work; verify `/api/team/context` and `/api/team/assignments` succeed.
- Change a preference and verify security audit recording does not emit Prisma `UnsupportedNativeDataType: void` / P2010.
- Open a person inspector, navigate through Settings and Projects, and verify stale `inspect=person:*` state is removed.
- Verify no `CLIENT_FEATURE_RENDER_ERROR` occurs.
- Observe `/api/projects` diagnostics and verify normal reads do not perform Library-folder reconciliation writes.

## 4. Offboarding regression

- In a disposable test account/project, preview an offboarding case with an active project membership.
- If practical, execute offboarding with a handoff user and confirm the departing membership becomes inactive and lead responsibility moves directly through `ProjectMembership`.
- Verify no obsolete project membership projection fields are written or required.

## 5. Shell, widgets, and visual integrity

- Verify My Work, Inbox, and Tickets are taskbar/global actions without redundant sidebar entries.
- Test Auto, Expanded, and Compact sidebar behavior at wide desktop, 900-1199px, and mobile widths.
- Overflow project tabs and exercise the open-project menu.
- Resize Home widgets with the bottom-right grip, including fast drag, viewport edge, minimum/maximum sizes, loading/error content, and keyboard actions.
- Inspect Home, Projects, People, My Work, Tickets, Inbox, Calendar/Scheduler, Library, Timeline, Boards, Whiteboards, Builds, QA, Source Control, Settings, Server Configuration, Operations, and Tool Infrastructure for clipping, overlap, cut-off icons, broken focus rings, or unusable nested scrolling.
- **Icon integrity gate:** inspect sidebar, taskbar, project tabs, page headers, dialogs, create flows, Library/viewer controls, and compact buttons at 100% and 125% Windows display scaling. No canonical icon may lose an edge, interior fill, or stroke segment.

## 6. Runtime chatter and performance

- Capture request logs during ordinary navigation.
- Check `/health/ready`, compatibility, sync delta/status, knowledge delta, client state, and Home/taskbar data for runaway duplicate polling or retries.
- Check query-budget telemetry for Projects, People, My Work, Home, Library, Timeline, and Operations with non-trivial data.

## 7. Native control panel and shutdown

- Verify log rendering, filtering, copy/autoscroll, progress states, DPI scaling, and resize behavior.
- Confirm ANSI escape sequences are not shown as visible garbage.
- Stop Cluster and verify API/workers/private Node/private PostgreSQL terminate.
- Close the control panel and immediately rename/delete the entire release folder. Any sharing violation or surviving Cluster-owned process fails the gate.

## RC17 disposition

- Compiler/runtime blocker: preserve evidence and produce the next RC17 WIP.
- Full checklist passes: RC17 can be promoted from WIP to the next Phase 10 release candidate state.

## 8. RC17 WIP4 evidence-driven regression gates

- Create a new project and keep the Operations/background-job view visible. Provisioning must complete without a Prisma `KnowledgeItem.archived` error and without creating a new dead-letter provisioning job.
- On Home, leave request logging visible for at least 60 seconds. `/api/timeline` must not repeat continuously with millisecond-different query windows; ordinary cache/refresh behavior is acceptable.
- During project creation, provisioning-status requests must use the backed-off cadence rather than the former ~350 ms loop.
- Open a collaboration-enabled surface on the normal same-origin localhost web app. The connection should settle on `Live`; `Polling fallback` is only acceptable when streaming genuinely fails or the connection is intentionally degraded.
- Open Project Overview with no recent activity and verify the empty-state sentence uses normal line wrapping rather than one word per line.
- Verify primary Project sections fit cleanly and secondary destinations are reachable through `More tools` without clipped horizontal tabs.
- Verify Tickets opens with its queue/navigation as the primary content. Expand `Analytics & saved views` and confirm the advanced tools remain usable without permanently consuming the top half of the screen.
- Verify required delivery-gate blockers remain visible while passing/advisory gates no longer produce a wall of equal-weight cards.
- Verify Operations makes useful use of desktop width and its health rail does not crush the main content.
- Re-run the WIP3 icon integrity gate. WIP4 must not regress icon geometry.

## RC17 WIP5 sidebar integrity gate

- Test expanded, compact, and Auto sidebar modes at 100% and 125% Windows display scaling.
- Verify expanded width and the content-grid boundary stay aligned with no gap or overlap.
- Verify compact mode is a clean 72 px rail with centered 44 px navigation targets.
- Verify the Cluster/studio header is compact and the collapse/expand control stays inside the header.
- Verify section labels have consistent spacing and do not collide with navigation rows.
- Verify Projects count, disclosure chevron, project names, project type labels, and project pin buttons never overlap.
- Verify all sidebar icons are fully visible and centered.
- Verify the server-status footer stays at the bottom without covering navigation content.
- Verify tablet/phone drawer opens to one stable width, ignores compact desktop state, and closes from both the close control and backdrop.


## RC17 WIP6 idle-runtime efficiency gate

- Leave the server and one signed-in client idle for at least 60 seconds. Confirm normal request logs do not flood the native control panel when request diagnostics are disabled.
- Confirm durable domain-event and resource-change database checks back off instead of remaining at 1 s / 750 ms cadence.
- Create/edit a resource and verify collaboration/resource-change UI updates remain prompt without waiting for the 15-second recovery ceiling.
- Enqueue a background job and verify local work begins promptly; then leave the queue empty and verify claim traffic backs off.
- Verify notification/resource-change SSE connections remain alive through their normal heartbeat path.
- Run a long-lived job and verify lease heartbeat and cancellation behavior still work while the job is active.
- Restart the server with queued/outbox work already in PostgreSQL and verify fallback recovery processes it without requiring a new local write.

## RC17 WIP8 cache/request precision checks
- Leave Desktop Native Services open and idle for at least 60 seconds; native file-watch/transfer state should stay current from push events without 1-2 second IPC polling churn.
- Modify a watched local file while its mounted viewer is open; preview state should react promptly from the native watcher event.
- Minimize/hide the Desktop renderer; watcher reconciliation polling should not continue while hidden.
- Perform mutations in Boards, Tickets, Calendar, Library, Packets, Whiteboards, People, and a less-common API domain; unrelated workspaces should not refetch wholesale.
- Verify logout/login/setup still clears authenticated query state globally.
- Keep Notifications open for several minutes; SSE notifications and 25-second heartbeat behavior should remain immediate while authorization recovery checks occur at the slower 60-second cadence.
- Inspect client performance diagnostics after normal editing; cache invalidation diagnostics should report evicted entry counts but must not reduce the cache-hit-rate calculation.


## RC17 WIP9 database/payload efficiency checks
- Load Projects twice without mutations. Confirm the second `/api/projects` request can revalidate with `304 Not Modified` when the project/capability payload is unchanged.
- With non-trivial whiteboards, compare `/api/projects` and `/api/whiteboards` payload sizes against WIP8. Collection responses must not contain whiteboard `elements`, categories, labels, production links, or other canvas bodies.
- Open a whiteboard from the collection and confirm `/api/whiteboards/:whiteboardId` still returns the full editable canvas.
- Check Operations database diagnostics after navigating Projects, People, Home, Tickets, Library, and a project detail. Inspect duplicate-query p95 and route-level duplicate fingerprints.
- Capture any route with high duplicate fingerprints before adding indexes or caches; use the fingerprint evidence to drive the next optimization pass.
- Verify project visibility/capability behavior for admin, ordinary member, and a project-scoped/external account after the reduced access-rule projection.

## RC17 WIP11 Home / My Work read-efficiency checks

- Open Home as an ordinary user and as an administrator. Confirm the personal time widget only reflects the current user and does not trigger a studio-wide time-summary aggregation.
- Open Home with ordinary personal widgets. `/api/team/assignments` should use `scope=mine`; enable a team-capacity/brief widget and confirm Home can intentionally switch to `scope=team`.
- Open My Work and confirm `/api/team/assignments?scope=mine` returns only the signed-in user's assignment envelope while preserving board, list, card, calendar, scheduler, and project-membership assignments.
- Assign a user only to a board column/list (not directly to the board or a card) and confirm the column assignment still appears in My Work.
- With many Tickets present, load Home and verify it calls `/api/tickets/assigned-summary` rather than `/api/tickets/workspace`; assigned-ticket cards and project/list labels must remain correct.
- Revalidate unchanged Home/My Work data and confirm `/api/team/assignments`, `/api/tickets/assigned-summary`, and `/api/calendar/upcoming` can return `304 Not Modified`.
- With project relationships present, compare database diagnostics for `scope=mine` against team scope; self scope should not load the entire relationship graph for unrelated project work.
- Load Calendar upcoming with several visible events/due cards as a non-admin and verify authorization remains correct while AccessRule reads stay batched rather than scaling one query per item.

## RC17 WIP12 Operations / notification / activity efficiency checks

- Open multiple Operations/admin panels that consume PostgreSQL diagnostics within 10 seconds. Confirm provider diagnostics are shared/coalesced rather than independently rebuilding the same database snapshot.
- Refresh the Operations control plane repeatedly within 10 seconds and confirm expensive aggregate probes are not rerun for every request; then wait beyond the TTL and confirm the snapshot refreshes.
- With several sync devices and security audit events present, inspect database diagnostics and confirm control-plane sync-device state is produced by one aggregate query and security failure state by one aggregate query.
- Type rapidly into Operations system search. Confirm the server receives a debounced search after roughly 300 ms rather than one request per keystroke.
- Open two Operations surfaces that request the same stable data at nearly the same time and confirm the client query layer deduplicates/coalesces the reads.
- Revalidate an unchanged `/api/notifications/summary` response and confirm private ETag/`304 Not Modified` behavior works.
- Receive a notification through SSE while the shell is visible. Confirm the preview updates immediately and only the compact notification summary is refreshed; the 40-item Inbox preview should not be immediately downloaded again solely because that SSE frame arrived.
- Test notification visibility as admin/owner and as a restricted ordinary user. Admin delivery must remain correct without activity-event authorization hydration; restricted users must still respect project/card visibility with the compact projection.
- Load Activity with a meaningful event history and compare payload/database diagnostics to WIP11. Activity rows must retain required user/project/board/whiteboard/card labels while hidden project memberships and nested authorization scaffolding are absent from the client response.
- Verify activity visibility for project-scoped/restricted users after the compact relation projection; no event outside the user's authorized scope may become visible.

## RC17 WIP13 project dashboard / notification / activity efficiency checks

- Open Project Overview as an administrator/owner on a project with substantial cards, assets, Timeline history, builds, QA, relationships, and activity. Confirm counters and recent/upcoming slices remain correct while database diagnostics show aggregate/count queries rather than full resource hydration.
- Open the same Project Overview as a restricted member with card, file, whiteboard, and Timeline access rules. Confirm all counts and visible items still respect resource visibility; the optimization must not leak restricted resources.
- With item-level Timeline rules absent, confirm overdue Timeline uses a direct count. Add a Timeline access rule and confirm the visibility-aware filtering path takes over.
- Verify Project Overview build totals/failures and QA plan/session/attention counters against the underlying records after the grouped/count conversion.
- Create project relationships that reference valid and deleted/missing resources. Confirm unrestricted overview relationship counts only include endpoints that still exist and remain tool-visible.
- As an administrator/owner with a large Inbox, refresh `/api/notifications/summary` and confirm database diagnostics show the single aggregate summary path; repeat unchanged reads and verify private `304 Not Modified` behavior.
- As a restricted user, revoke project/card access associated with notifications and verify the notification summary excludes the newly inaccessible records.
- Load Activity first pages and cursor pages as admin and restricted users. Confirm ordering, `X-Next-Cursor`, pagination continuity, and visibility remain correct with no duplicated or skipped visible events.
- Revalidate an unchanged Activity page and confirm private ETag/`304 Not Modified` behavior.
- On projects with many members and a long Activity history, compare Activity payload/query diagnostics with WIP12; authorization hydration should include only the requesting user's relevant membership data.

## RC17 WIP16 media / filesystem / renderer-pressure checks

- Queue several media derivative jobs for the same project and observe disk activity. Normal quota checks should no longer recursively enumerate `.cluster-viewer-cache` before every derivative.
- Reuse an existing derivative recipe/source checksum and confirm reuse succeeds without a second full hash of the copied/hard-linked output.
- Queue several Library derivative jobs close together and confirm FFmpeg/FFprobe capability discovery is shared rather than spawning tool-version/encoder probes for every job.
- Run a long FFmpeg media job and cancel it. Cancellation should remain responsive while background-job cancellation reads occur at the slower media-specific cadence and the child process follows the worker AbortSignal.
- Observe a long encode in database/request diagnostics. Progress writes should be throttled rather than arriving in rapid bursts for every FFmpeg progress line.
- Open an image in the unified viewer with comparison disabled and verify only one primary image resource is loaded/held. Enable comparison and verify the second resource then loads correctly.
- Populate Library grid view with many video files and scroll slowly. Offscreen cards should not create video metadata requests until they approach the viewport; visible thumbnails should still capture correctly.
- Re-run renderer heap/request-rate diagnostics while opening and closing media viewers repeatedly and verify object URLs/media allocations return toward baseline after viewers unmount.


## RC17 WIP17 renderer / WebGL / Whiteboard pressure checks

- Open a static 3D model and leave the viewer untouched. Confirm the stage does not keep a permanent 60 FPS render loop alive; orbit/zoom/settings changes must still render immediately.
- Scroll the 3D viewer fully offscreen or hide the app/document, then inspect renderer CPU/GPU activity. Stage rendering should suspend and recover when visible again.
- Toggle wireframe, lighting, skeleton, named views, camera restore, annotation pins, and model animations. Visual state must remain correct after the on-demand render conversion.
- Play video/audio and inspect React/render diagnostics. Playback controls should remain smooth while React-facing timed-media/meter updates stay around the 30 Hz cap rather than frame-rate commits.
- Pause media and hide/show the document. Audio metering and timed-media UI commits should stop while inactive and resume with current state when active again.
- Run image comparison in Blink mode, hide the document for several seconds, then return. Blink timing should resume without a hidden periodic loop consuming renderer work.
- Exercise Whiteboard on small, ~1k-element, ~2k-element, and 4k+-element canvases. Drag/resize/connector interactions should remain immediate while outline/navigator/stats projections are allowed to settle afterward.
- Perform long Whiteboard undo/redo sequences at each canvas size. Verify behavior remains correct with adaptive local history depth and no corrupted shared element state.
- Edit a Whiteboard and then undo exactly back to the server-loaded state. Dirty/save state must return to clean after the deferred semantic reconciliation.
- Test remote/non-overlapping Whiteboard merge behavior, save/reload, category/label/production-link edits, and Fit to content after recent edits; deferred projections must not change persisted semantics.
- Rapidly edit several cards on a Board. Confirm planning requests coalesce behind the ~180 ms debounce while the final planning payload reflects the latest card revisions.
- Repeatedly open/close 3D, media, and large Whiteboard workspaces and confirm renderer heap/RAF/long-task diagnostics return toward baseline after unmount.

## RC17 WIP18 startup / navigation / mount-pressure checks

- Cold-start Cluster on Home and capture the initial Network/module timeline. Admin, Settings, Tickets, QA, Boards, Whiteboards, Library, Packets, project Source Control, and other inactive workspaces must not load before navigation requires them.
- Configure a non-Home start screen (for example Projects or My Work) and confirm the Home/Dashboard chunk is not requested during the initial route.
- Open Command Palette and Quick Create from a fresh session. Their chunks should load on first open and remain responsive on subsequent opens.
- Cold-start on Home with multiple Boards/Whiteboards in the studio. Confirm no full Board endpoint is fetched merely because a first Board exists, and global Whiteboard summaries remain unloaded until a route that needs them is opened.
- Open a Board, leave it for more than 15 seconds, then inspect renderer memory/state. Full Board React state should be released; returning should restore promptly through the query cache/network path.
- While away from Board, apply a remote Board/Card delta and confirm the inactive full Board is not reloaded. Return to Board and verify canonical current state is recovered.
- Navigate between Home, Projects, Project Detail, Admin, Settings, Tickets, QA, Library, People, and Timeline. Verify route-owned CSS arrives with the owning feature and no flash of unstyled content occurs.
- Open/close expensive master-detail inspectors (Library/media/project/ticket surfaces) repeatedly and confirm hidden detail component trees unmount and renderer heap returns toward baseline.
- Scroll a large virtualized `ClusterDataTable` slowly and quickly. React updates should track row-window crossings rather than every scroll pixel while selection/grouping behavior remains correct.
- Exercise grouped tables with parents that rerender frequently. Group projection should remain stable when only the inline `rowKey` function identity changes.
- Compare cold-start route performance/runtime diagnostics against WIP17 and record shell navigation latency, initial request count, JS/CSS transfer, and renderer heap baseline.

## RC17 WIP19 persistent-shell / bootstrap checks

- Cold-start the web renderer on setup/login and confirm the desktop runtime chunk is not requested before a desktop-only capability is needed.
- Cold-start Cluster Desktop and verify native capability transport, deep-link routing, session claim, kiosk status, notifications, and native clipboard still initialize correctly after the desktop-only dynamic bootstrap change.
- Load setup/login/public/legal surfaces while signed out and inspect IndexedDB/service-worker/offline-sync activity. Offline queue recovery and sync initialization should remain dormant until an authenticated user is established.
- Sign in with queued offline work present and confirm the offline runtime loads, recovers queue/upload state, updates Sync Status, and resumes normal replay/pull behavior.
- Sign out from Cluster Desktop and confirm native authentication state is still cleared even though native cleanup is dynamically loaded from the API cache invalidation path.
- Open a resource-window recovery session and restore detached workspaces; native window recovery must still function with the dynamic desktop import.
- On web, exercise Copy link, table copy, request diagnostics copy, project share links, and workflow mention/deep-link copy. These actions should work through browser clipboard without loading the desktop bridge.
- With an existing privacy decision, cold-start and confirm the public consent-config endpoint is not fetched solely at renderer boot and no extra `/api/me` request originates from PrivacyConsentManager. Open Privacy Choices and verify config then loads normally.
- Clear privacy consent and reload. The consent dialog/config must still appear immediately and server consent synchronization must occur after identity becomes available.
- Hover repeatedly across the same sidebar route within 30 seconds. Module/data prefetch should coalesce/cool down instead of repeatedly revalidating the same route.
- Enable browser Save-Data or emulate slow-2G/2G, then hover sidebar routes. Speculative route/data prefetch should remain disabled while explicit navigation still loads normally.
- Hide the document/tab and trigger sidebar hover/focus events before hiding. No new speculative prefetch should begin while hidden.
- Hover My Work and inspect the prefetched assignment request. It must use `scope=mine`, not team-wide assignment state.
- Cold-start an established studio and verify Setup Wizard, desktop presence, Operations CSS, and saved-view toolbar CSS are not part of the initial synchronous shell unless their owning feature/session requires them.
- Compare cold-start performance against WIP18: renderer entry parse/evaluation, authenticated shell readiness, initial request count, offline/IndexedDB work, and time until the first interactive route.

## RC17 WIP21 footage / navigation / Shared Create checks

- Cold-start and compare the left sidebar against the 2026-09-28 recording. Section labels should be clean, repeated divider lines/fragments should be gone, and icons/chevrons must not clip at 100%, 125%, or 150% Windows display scaling.
- As an administrator, confirm Operations remains directly accessible while Tool Infrastructure, Integrations, Studio Settings, and Server Configuration appear under the Admin tools disclosure. People must stay out of the main sidebar and open from the account menu; People admin capabilities must use the shared People workspace. Source Control configuration must live under Tool Infrastructure, project repository work must live inside the project, and Versioning must live inside Studio Settings.
- Test expanded, compact, and mobile/drawer sidebar modes. Compact mode must not expose an unusable nested admin list; selecting the admin control should still take the user to Operations.
- Open Shared Create for Project, Card, Ticket, Calendar, and Packet. Verify the form no longer shows the old stacked Context applied / Required / Essentials first guidance or redundant control descriptions. Actual validation/progress/error messages must still appear in the footer when needed.
- From Packets, press Create and verify it opens the canonical Shared Create Packet mode. Create Packets for Whole studio and targeted audiences; targeted audience with zero targets must be blocked before submission. Reusable-form completion must require a form.
- After creating a Packet through Shared Create, confirm Packets refreshes and selects the created Packet. Edit its existing Packet settings afterward and verify the local settings editor still works.
- Open Home with empty widgets and Account Settings Profile. Confirm the removed narration does not leave broken spacing, blank helper rows, or oversized empty states.
- Open Tool Infrastructure → Source Control and verify native repository/runtime settings and optional remote-provider configuration are visually separated, health/latency is readable, and narrow table widths do not concatenate or clip provider metadata.
- Recheck the title/header icons, sidebar icons, Close/chevron/settings icons, and create-mode icons at common zoom/display scaling. SVG artwork may extend beyond its viewBox without being shaved by wrapper overflow.

## RC17 WIP29 sidebar / readability / Library upload checks

- Expand and collapse the sidebar repeatedly. Icons must remain visible, centered, and stable; the WORK / PLAN / LIBRARY / PEOPLE / ADMIN category labels should no longer consume vertical space.
- Navigate several sidebar destinations and command-search results. Active selection should use a light wash and slim marker rather than a heavy full outline.
- Open Shared Create and confirm the top-right X has no redundant visible Close label while retaining tooltip/accessible labeling.
- Visit People in normal and authorized admin mode, Notifications, Library, admin/settings, and modal surfaces. Text-bearing regions must have an opaque backing layer even when the outer canvas/theme uses glass.
- Open a saved external link from Library. Confirm the viewer is compact and omits media-review context, file rail, previous/next controls, status footer, and media shortcuts.
- Upload a batch of files while interacting with Library. Progress must continue without freezing the renderer. If the network is interrupted, verify the active file is queued durably and can resume/replay.

## RC17 WIP35 Structural Pass 3 convergence / native Source Control / long-idle diagnostics

- Open People from the account menu as a normal user and as an authorized administrator. Confirm both modes use the same directory/person-detail workspace; admin-only lifecycle/access actions appear contextually rather than mounting a second People application.
- Exercise People, Projects, Tickets, Background Jobs, and Studio Knowledge data surfaces. Search/filter controls must use the compact shared table toolbar/filter backing, and saved views must use the compact View selector/manager rather than a full-width wall of named-view pills.
- In each migrated data surface, create a personal saved view, apply it, update it, set it default, delete a different inactive view, and verify the current active view remains selected.
- Create an Unreal project. Verify Cluster automatically provisions and binds a native repository, exposes the project Source Control tab, seeds the default branch, and applies Unreal-oriented LFS defaults.
- Create a software/code project and verify the native repository is provisioned and bound automatically. Create a Video project and verify Source Control is not provisioned by default.
- On a Cluster-native repository with no external provider configured, open project Source Control, prepare a working copy, create a branch, commit, push, open a review, and merge. None of these native Git operations may require Discord, Integrations, GitHub, GitLab, or another provider connection.
- Open a Board card in a project backed only by Cluster-native Source Control. The External issue section must explain that issue linking is off; native Source Control must remain healthy. Add an optional remote/provider and verify external issue list/link/create/comment/state operations become available without replacing Cluster Source Control.
- Verify Source Control authorization uses the `sourceControl` tool permission. Granting Integrations access alone must not grant repository administration, and denying Integrations must not disable native project Source Control.
- Leave a signed-in client hidden/minimized for at least five minutes with queued mutations, then return. In Sync Center verify Last hidden is populated, Idle catch-up shows paced drain cycles while active, and Last mutation drain reports count/cap/duration. The first four catch-up drains should cap at 40 mutations rather than releasing the entire backlog at once.
- Repeat the hidden/minimized test for an overnight/one-day session. Confirm scheduler/SSE progression continues while hidden, queued work is paced on return, resource-change reconciliation does not create a thundering herd, and lower-priority background work does not remain permanently starved.
- Force a stale `/api/client-state/user/*` revision and verify the deterministic private client-state write rebases once without a user-facing conflict. Then create a meaningful shared-content conflict and verify Cluster does not silently discard either user-authored version.
- Recheck 100%, 125%, and 150% Windows scaling after the data-toolbar changes. Search, filters, View selector, table selection controls, icon buttons, and project Source Control controls must not clip or overlap.

## RC17 WIP35 Structural Pass 4 project provisioning / permission split gate

- Open Home as an administrator with both Source Control and Integrations enabled. Repository health/review widgets must open Projects/project-owned Source Control, while Integration Health must open Integrations. No Home action may resurrect a standalone Source Control workspace.
- Test a role with `sourceControl` access but no `integrations` access. Project Source Control, repository health/review Home data, and authorized Source Control operations must still load. External provider/Discord configuration must remain unavailable.
- Test a role with `integrations` access but no `sourceControl` access. Integration Health may load when otherwise authorized, but repository catalog/create/edit/delete and project Git operations must remain unavailable.
- From Home repository health, open a repository that is bound to a project. The item must navigate directly to that project’s **Source Control** tab. An unbound repository may fall back to Projects/configuration but must not target a deleted standalone route.
- In Shared Create, create an Unreal project and inspect the authoritative provisioning preview/progress evidence. It must report Source Control capability `required`, automatic Cluster repository provisioning, default branch `main`, Unreal ignore defaults, and LFS enabled unless studio/project-type policy explicitly overrides them.
- Create a software/code project. The preview/receipt must show capability-driven automatic Source Control and software ignore defaults. The completed durable operation must return a repository ID/binding ID and branch evidence.
- Create a Video project. The preview/receipt must show Source Control off/skipped by default and the durable operation must complete with no repository ID unless Source Control was explicitly enabled.
- Repeat a durable provisioning request with the same provisioning key to exercise resume/idempotency. If Git bootstrap is intentionally failed on the resumed operation, the already-existing project must be preserved. A newly created partial project may be rolled back when its automatic repository cannot be provisioned.
- Inspect the completed `project.provision` operation/receipt. Source Control evidence must include state, binding/repository IDs when present, hosting mode, default branch, LFS, ignore template, requested mode, capability, and whether Source Control was required.
- Open People, Projects, Tickets, Background Jobs, and Studio Knowledge. Saved-view creation controls must stay collapsed behind **Save view** until requested; creating/cancelling a saved view must not permanently widen the data surface.
- Re-run the five-minute and overnight hidden-client tests from Pass 3 and capture Sync Center evidence. Pass 4 does not waive the requirement for real Windows/runtime proof of paced replay, scheduler/SSE health, and meaningful conflict preservation.

## RC17 WIP35 Server Infrastructure Pass 1 storage / portability gate

- Configure `dataRootOverride` to a second local drive, restart through the real Windows bootstrap, and confirm Projects, Library, Users, Backups, Logs, Runtime, Exports, Uploads, Branding, and System resolve beneath the new root unless explicitly overridden.
- Configure Projects and Backups to separate drives while leaving the main Data Root unchanged. Confirm uploads/project creation accept the external project root and diagnostics report it as external storage rather than rejecting it as outside the Data Root.
- With Cluster and its private PostgreSQL fully stopped, run the Data Root migration tool first without `--commit=MOVE_CLUSTER_DATA`. Confirm every copied file is SHA-256 verified, the destination must be empty, the old root remains untouched, and `cluster.config.json` is not changed during the dry migration.
- Repeat the migration with `--commit=MOVE_CLUSTER_DATA` and an explicit config path when appropriate. Confirm the config pointer changes only after verification completes, the old root remains intact, and the server starts from the new Data Root.
- Leave Cluster running and attempt the migration. It must refuse while a server runtime marker is active. Leave a private PostgreSQL `postmaster.pid` present and confirm migration also refuses rather than copying a possibly-live database directory.
- Create a software/code project and confirm its canonical bare repository is stored at `Project/.cluster/source/repository.git`, not under the global repository-mirror directory. Working copies/review worktrees must live under `Runtime/GitWorktrees` and be safely disposable.
- Create an Unreal project on a Windows bootstrap that includes Git LFS. Confirm Git runtime diagnostics report LFS availability before provisioning succeeds, `.gitattributes` contains the Unreal LFS policy, and LFS object storage remains inside `.cluster/source/repository.git/lfs` for Cluster-managed repositories.
- Temporarily remove/disable Git LFS and attempt Unreal provisioning. Cluster must fail clearly with a Git-LFS-required error and must not leave a healthy-looking half-configured Unreal repository.
- Upload a project file while Projects and System/ManagedBlobs are on the same NTFS volume. Confirm the file exists in `Project/Files` and the managed-blob acceleration copy may be materialized with a hardlink rather than duplicate physical bytes.
- Repeat with Projects on a different volume (or an object-storage managed blob). Confirm Cluster falls back to a verified physical project copy and the project remains self-contained.
- Make the managed blob unavailable for a project file while leaving the portable `Project/Files` copy intact. Downloading the project file must fall back to the project copy rather than treating the acceleration layer as the sole source of truth.
- Inspect a project directory after editable-data mirror sync. Generated bookkeeping must live under `.cluster/state`; legacy root/Files/Media/Builds/Library JSON mirror files must not reappear in the human-facing tree.
- Verify `.cluster/integrity.json` validates `manifest.json`, `project.json`, and the state snapshots. Corrupt one state file and confirm capsule verification reports the mismatch.
- Copy an entire project folder to a test location and run capsule discovery/verification. Cluster should recognize the `cluster-project` manifest and detect whether the embedded repository is present. Database re-import/restore remains a later gate and must not be claimed from discovery alone.
- In Admin Diagnostics, verify storage topology/health reports configured paths, availability, writability, free/used bytes, external-root state, and discovered project capsule/repository counts.
- Delete `Runtime` while Cluster is stopped, restart, and confirm disposable cache/worktree directories are recreated without losing project files, project state snapshots, or the canonical Git repository.

## RC17 WIP35 Server Infrastructure Pass 2 acceleration / realtime gate

- Start Cluster with acceleration mode **Automatic** and no Redis URL configured. The server must become ready normally, Operations must report the bounded memory backend, and PostgreSQL-backed rate limits/jobs/events must continue to work.
- Configure a valid Redis-compatible endpoint and restart. Operations/Architecture must report the Redis backend as distributed/healthy, with the configured URL redacted and the key prefix visible.
- Exercise Project Overview/other project read-model consumers from two server processes where possible. The second process should record shared-cache hits after the first process warms the model, while project mutations invalidate both local and shared cache state promptly.
- With Redis active, exercise API/auth/upload rate limits. Operations must record acceleration hits. Stop Redis and verify rate limiting falls back to PostgreSQL instead of failing open or taking the API offline.
- Stop Redis while Cluster is running in **Automatic** mode. Cluster must stay operational, report the acceleration tier as unavailable/degraded evidence via the last Redis error, use bounded memory/PostgreSQL fallbacks, and retry Redis in the background without blocking request handling.
- Bring Redis back. Confirm Cluster reconnects without a server restart and resumes distributed cache/bus/rate-limit behavior.
- Set acceleration mode to **Redis required**, stop Redis, and restart Cluster. Startup must fail clearly rather than silently claiming the required distributed tier is healthy.
- Enqueue a durable background job from one process while another worker process is idle. The remote worker should wake promptly from the coordination hint; PostgreSQL remains authoritative and the job must still recover by fallback polling if the hint is intentionally dropped.
- Create/edit a resource while another API process owns an SSE client. Resource-change delivery should wake promptly from cross-process coordination instead of waiting for the idle recovery poll.
- Generate a sustained burst of resource changes. Verify wake storms do not postpone an already scheduled poll, `wakeCount` rises, and the next poll remains immediate rather than behaving like a debounce.
- Leave events/jobs/resource changes idle for several minutes. Confirm fallback polling backs off toward the configured 60-second ceiling instead of continuing at the former 15-second cadence; create new work and confirm it wakes immediately.
- Throttle or pause an `/api/changes/stream` client until its socket/queued-batch limits are exceeded. The server must reset/disconnect that slow client without stalling healthy subscribers; reconnecting with the durable cursor must recover state.
- Repeat the slow-client test against collaboration SSE. Intermediate full-state/ping frames may be skipped under backpressure, and a client exceeding the hard buffer limit may be disconnected, but other clients must continue receiving current state.
- In Operations Performance/Health, verify acceleration cache/bus metrics, distributed rate-limit fallback counts, resource-change wake/poll evidence, job-runtime wake/fallback evidence, and collaboration backpressure counters are visible.
- Verify Redis credentials never appear in server logs, diagnostics, exported settings, or API responses. Server Config must display only the masked configured-secret state/fingerprint.
- Confirm the Redis-compatible tier contains no authoritative Projects, Users, Tickets, audit records, time records, or durable job state. Flush Redis completely and verify Cluster reconstructs hot state from PostgreSQL/filesystem data without data loss.

## RC17 WIP35 Server Bugfix Pass 1 failure-mode gate

- Connect an `/api/changes/stream` client with a stale cursor, generate more than 250 resource changes while it reconnects, and verify paged bridge catch-up reaches the durable cursor with no missing sequence. Repeat with enough traffic to force a reset; events created after the reset cursor is captured must still arrive after the reset.
- Start with Redis healthy, warm a shared project read model from process A, stop process A, mutate/invalidate the project from process B, and read from a fresh process C. C must not resurrect A's stale Redis payload.
- Consume part of a rate-limit window through Redis, then kill Redis mid-window. PostgreSQL fallback must preserve the observed usage instead of granting a fresh allowance.
- Drop Redis after startup in Automatic mode and Redis-required mode. Stale events from the old Redis clients must not mark a newer reconnect unhealthy. Automatic remains operational through fallback; required mode must not report distributed health until Pub/Sub is actually subscribed.
- Configure Runtime inside Projects (and Projects inside Runtime) and attempt to save. Storage topology validation must reject both. Repeat with two durable top-level domains sharing the same path.
- Attempt to change the running Data Root through normal Server Settings. The request must return `STORAGE_MOVE_REQUIRED` rather than saving a pointer to unmoved durable data.
- Put files in Projects, Library, Users, Backups, Logs, Exports, Uploads, or Branding and attempt to repoint that populated domain through normal settings. The request must require a verified domain move instead of abandoning the existing files.
- Configure Runtime on an external drive, leave Cluster's runtime marker active there, and run the Data Root mover. The mover must detect the actual external runtime path and refuse the move while Cluster is running.
- Move a Data Root with an absolute Projects override that points inside the old root plus an external Runtime override. Commit must rewrite the internal Projects path beneath the new root while preserving the external Runtime path.
- After moving the Data Root, run `storage:sync`. It must use `dataRootOverride` and configured storage-domain overrides and must not recreate project/user/library mirrors beneath the old default workspace `data` directory.
- Remove one required file from `.cluster/integrity.json`, duplicate an integrity entry, remove project identity, and mismatch project IDs between manifest/project state. Capsule verification must reject each malformed capsule.
- Corrupt an existing managed blob without changing its byte length, then upload identical expected content. Cluster must detect the SHA-256 mismatch, repair the cache object from verified input when possible, and never materialize the corrupt bytes into the portable project copy.
- Run multiple same-process storage writes targeting the same final object under high concurrency. UUID-backed staging names must prevent one writer's cleanup from deleting another writer's temp file.
- Seed enough old processed/dead-letter resource-change outbox rows to exceed the prune batch. One cleanup cycle must delete no more than `CLUSTER_RESOURCE_CHANGE_PRUNE_BATCH`; subsequent cycles may continue the cleanup without one giant transaction.
- Restart with many projects/files/boards/media/library rows and compare startup mirror time/query/CPU against Pass 2. Record grouping should be linear by record count rather than repeatedly scanning every full array per project; unchanged capsules should not rewrite `integrity.json`.

## RC17 WIP35 Server Bugfix Pass 2 bootstrap / recovery / lease gate

- Move Data Root and Runtime to a second drive, complete the dependency bootstrap, then run database validate/status/doctor. Database tooling must locate the configured `Runtime/server.env` and the bundled/materialized Prisma schema without walking past the release root.
- Perform an offline recovery while the live boot config remains in the release/workspace root. The restored config must be committed to that real boot config path, not written as an unused `DataRoot/cluster.config.json`.
- Create a backup on machine/storage layout A, then restore it using layout B with different Data Root/Projects/Library/Users/Branding paths. Logical settings may restore, but physical storage overrides must remain the restore machine's current/explicit topology and must not resurrect A's stale drive letters.
- Put Projects, Library, Users, Branding, and Uploads on external volumes, create a backup, and inspect/restore the generation. Recovery metadata must identify each external domain and stage it to the configured/explicit target instead of silently redirecting it under Data Root.
- Configure Backups to an unavailable NAS/share and restart Cluster. The server should start in a degraded-storage state; attempting a backup should fail/report the unavailable target without taking normal project/API operation offline.
- Try to configure Projects, Runtime, Library, or another independently managed domain inside `System`, `System/PostgreSQL`, or vice versa. Storage topology validation must reject the overlap.
- Put Projects/Users/Branding on external Windows volumes and exercise legacy/direct upload paths, avatars, and branding. Configured roots must be accepted despite drive-letter case differences; paths outside all configured roots must still be rejected.
- Start a long-running durable job, interrupt PostgreSQL long enough for multiple lease heartbeats to fail, then recover PostgreSQL. The original worker must abort once lease confirmation exceeds its safety window; no second worker may execute the same side effect concurrently.
- With Redis healthy, consume part of a rate-limit window; stop Redis and consume through PostgreSQL fallback; restore Redis before the window ends. Recovery must not grant back requests already consumed during fallback. New windows may return to Redis normally.
- Force a Redis command-level failure without a clean connection `end` event. Automatic/required modes must schedule reconnect rather than remaining permanently degraded on the old client state.
- Throttle a notification SSE client until its write buffer exceeds the configured limit. The slow client must be ended without unbounded memory growth or affecting healthy notification subscribers.
- Seed a large backlog of terminal BackgroundJob history and expired RateLimitBucket rows. Maintenance must remove bounded batches with yields rather than issuing one unbounded delete transaction.

## RC17 WIP36 Bugfix + UI Primitives Pass 2 modal convergence gate

- Open Board Archive from a populated Board. Escape, backdrop click, and the Close control must all dismiss it and return focus to the invoking control.
- Open Card Editor, make a change, then use Escape and backdrop click. Both paths must run the existing discard-confirmation flow rather than dropping changes.
- Start a Card save and attempt Escape/backdrop close while the save is active. The editor must remain open until saving resolves or errors.
- Open Calendar event and meeting editors. Escape/backdrop/Close must dismiss through the shared modal behavior without changing editor geometry. Repeat with a private redacted meeting.
- Open Keyboard Shortcuts from the shell, close it with Escape/backdrop/Close, and verify focus returns to the launcher.
- Open Customize Home at desktop and mobile widths. Its existing custom editor/backdrop layout must remain intact; Done, Escape, and backdrop must all close it cleanly.
- At 100%, 125%, and 150% Windows scaling, verify the migrated dialogs remain fully reachable, scroll when required, and do not clip close controls or footer actions.


## RC17 WIP37 Bugfix + UI Primitives Pass 3 modal convergence gate

- Open Timeline composer and Timeline detail. Escape, backdrop click, and explicit Close must dismiss through the shared modal contract, preserve the fullscreen geometry, and return focus appropriately.
- Open Time Off and Schedule Planning. Verify their existing layouts/controls are unchanged. While Time Off is busy, Escape must remain disabled; backdrop behavior must match the previous dialog.
- Open a schedule-block detail and the Break dialog. Escape/backdrop/Close must dismiss cleanly without breaking edit/reconcile/break actions.
- Open Project Builds release-note and Project QA-session inspectors. Linked Work, evidence/activity, delivery-risk, and action-menu content must remain visible and functional after migration.
- Open Command Palette from its normal launcher/hotkey. Arrow/Home/End/Page navigation, Enter, desktop Ctrl+Enter, diagnostics, saved searches, Escape, and focus return must behave as before.
- Open Library media preview for image/video/audio/PDF/3D/text and an external link. Verify rail toggling, previous/next, PageUp/PageDown, shortcut help, download/open-link actions, scroll locking, and Escape.
- Open Library folder permissions, create-folder, web-link, YouTube-video, and YouTube-playlist dialogs. Verify backdrop/Escape/close actions and all save/create controls.
- Open Packet settings for an active packet. Verify fields, completion-mode controls, Save/Cancel, Escape, and backdrop behavior.
- Enter signed-out kiosk mode and request administrator exit. Test password and PIN, invalid credentials, busy verification, Cancel, Escape, and backdrop. Busy verification must not be dismissible.
- At 100%, 125%, and 150% Windows scaling, verify every WIP37 migrated modal remains reachable and does not clip close controls, headings, inspectors, or footer actions.

## RC17 WIP38 Bugfix + UI Primitives Pass 4 special-host convergence gate

- Open Shared Create with no handoff. Verify picker search/recent/specialized modes, Escape/backdrop/Close, focus return, and unchanged workspace geometry.
- Enter a Shared Create form and make meaningful edits. With draft autosave enabled, Escape/backdrop/Cancel must persist the draft and reopening must surface recovery. With autosave disabled, all close paths must run the discard confirmation.
- While a Shared Create operation is busy, Escape must remain disabled and backdrop/Cancel attempts must not close the workspace. The existing busy/status feedback path must remain intact.
- In Shared Create form mode, Ctrl/Cmd+Enter must submit exactly once. The same shortcut must not submit while the mode picker is active.
- Exercise Reauthentication through password, Security PIN, and passkey/security-key modes, including invalid credentials and failed WebAuthn. Body scroll lock must restore after dismissal. Busy verification must block Escape/backdrop/Cancel.
- Exercise Security PIN verify, setup, and change flows. Verify Current/New/Confirm phases, mismatch handling, Clear/Delete, Enter, whole-dialog Escape behavior, and configured-PIN completion.
- During Security PIN API verification/save work, Escape/backdrop/Cancel must not dismiss the host. Existing `data-mode`/`data-phase` styling must remain correct through every phase.
- At 100%, 125%, and 150% Windows scaling plus phone-width responsive mode, verify Shared Create, Reauthentication, and Security PIN retain their pre-WIP38 custom overlay geometry rather than inheriting generic `.modal-backdrop` sheet rules.
- Verify Privacy Consent remains a startup/legal gate and was not made dismissible or converted into an ordinary feature modal.

## RC17 WIP39 Bugfix + UI Primitives Pass 5 inspector / drawer convergence gate

- Open Viewer Review on an asset with review history. The panel must use the same docked drawer geometry as Inspector/Overlays, show unresolved/total counts in the shared header, and remain fully usable at narrow widths.
- In Viewer Review, use Alt+ArrowUp / Alt+ArrowDown outside editable fields. Unresolved-comment navigation must still work after the shared inspector migration.
- Open Viewer Keyboard Shortcuts. The shared circular close control must dismiss the panel without changing the shortcut list or accessibility guidance.
- Open Viewer Inspector and Overlays. Shared panel headers must use compact icon actions for detach and close so narrow inspectors do not clip long action labels.
- Open an Operations detail drawer from at least two different Operations/Admin workflows. Backdrop click and Escape must both close the drawer, and focus should return to the invoking control when practical.
- While any true modal is open above an Operations detail drawer, pressing Escape must dismiss/affect only the top modal and must not close the drawer underneath it.
- Verify the Operations detail drawer retains its existing right-side desktop geometry and bottom-sheet responsive layout; the shared interaction shell must not replace its existing `detail-drawer-*` styling.
- At 100%, 125%, and 150% Windows scaling, verify Viewer Review, Viewer Shortcuts, Viewer Inspector, Viewer Overlays, and Operations detail drawers keep headings/actions reachable with no clipped close controls.
- Repeat the viewer checks at <=620px container width. Docked panels should stack below the stage and remain scrollable rather than overflowing horizontally.


## RC17 WIP40 Bugfix + Home Composer Pass 1 gate

- Enter Home edit mode at a normal desktop width. A visible placement grid and the widget palette must appear without moving the page header or clipping the edit toolbar.
- Search the palette and switch among All, Built in, Gallery, and Installed. Studio-unavailable or extension-policy-blocked widgets must remain non-draggable/non-addable.
- Drag a disabled built-in widget from the palette onto open canvas space. The drag preview must remain visible outside the palette scroll area and the widget must appear on Home.
- Drag a disabled gallery/custom widget onto an existing widget. Drop on different sides of the target and verify placement follows the pointer-relative before/after decision rather than always appending.
- Drag existing widgets around the grid repeatedly. Verify cards reorder without duplicate widgets, disappearing cards, stuck drag transforms, or lost widget content.
- Resize widgets from the lower-right handle across multiple size steps. Verify the card snaps cleanly, dynamic row-span measurement settles, and neighboring widgets repack without overlap.
- Remove a widget with the circular X, then immediately drag it back from the palette. Its prior configuration/size should remain intact unless existing product behavior intentionally resets it.
- Change Density between Compact, Balanced, and Expanded from the edit toolbar. Verify the live canvas updates immediately and the preference survives a reload.
- Change Phone layout between Stack, Grid, Carousel, and Focus from the edit toolbar. Verify the preference survives reload and the existing mobile behavior remains intact.
- At 1180px and narrower, verify the palette stacks above the grid instead of crushing the widget canvas. At phone width, the toolbar and palette controls must stack cleanly with no horizontal clipping.
- In phone Grid mode, confirm micro/compact widgets occupy one of two columns while standard/wide/large/feature widgets span both columns. No implicit off-screen columns or horizontal page scrolling should be created.
- Test a 1600px+ window and a 2200px+ window. The composer should increase to 16 and 20 columns respectively so widgets do not become absurdly wide on large monitors.
- Open Advanced settings from edit mode. Verify Advanced layout, Sources & gallery, Profiles, custom widget install/remove, profile import/export, governance, and widget-specific options still work.
- Start from an empty Home. The non-edit empty state must offer Customize Home; after entering edit mode, dragging a widget onto the empty canvas must work.
- Repeat drag/resize tests at 100%, 125%, and 150% Windows scaling. Drag handles, close controls, palette actions, and grid drop feedback must remain reachable and unclipped.

## RC17 WIP41 Bugfix + Home Composer Pass 2 launch-layout gate

- Enter Home edit mode, drag an existing widget horizontally to a different visible grid column, finish editing, reload Cluster, and verify the widget returns to the same horizontal column.
- Repeat horizontal placement at normal desktop, 1600px+, and 2200px+ widths. Confirm the active 12/16/20-column grid is used and persisted columns clamp cleanly when moving back to a narrower window.
- Drag a widget onto open canvas space without crossing another widget. Its horizontal column should change while its vertical/source order remains stable.
- Drag a widget onto another widget on each side of the target. Confirm the new column and before/after order are committed together without a visible intermediate jump or duplicate persistence request.
- Drag a disabled palette widget to a specific grid column. Confirm it is enabled, ordered, and placed in one operation and remains there after reload.
- Use the keyboard layout controls on a selected widget. Left/right must nudge one grid column; up/down must move earlier/later. Boundary presses must clamp safely without creating off-grid placement.
- Resize a widget slowly across multiple size thresholds. During pointer movement only the preview should change; the persisted size should commit once when the pointer is released.
- Cancel/lost-pointer-capture during resize and verify the previous persisted size remains intact and no resize badge/outline is left stuck on screen.
- Resize a widget near the right edge to a wider size. Its stored/effective column must clamp so the widget remains inside the active grid with no horizontal page overflow.
- Collapse the widget palette on a desktop-width window. Confirm it becomes a narrow usable rail, the canvas receives the freed width, and expand restores the full searchable palette.
- With the palette collapsed, shrink below 1180px. Confirm the rail becomes a compact horizontal header rather than producing a tall vertical obstruction or clipped controls.
- Click the circular settings control on several different widgets. Home settings must open on Advanced layout, expand the requested widget entry, and scroll that entry into view.
- Edit a widget configuration from the focused editor, close it, and verify the live widget reflects the change without requiring a reload.
- Save a Home layout profile, reload, apply it, export/import it, and verify column values survive every path under schema 2.
- As an administrator, publish and re-apply a Studio Home template containing micro, large, and feature widgets. The server must accept all current size values and retain columns/configuration.
- Share a personal Home profile, retrieve it from another eligible session/user, and apply it. Verify the current schema-2 sharing endpoint accepts and returns column/configuration fields without validation errors.
- Confirm a fresh install creates only `dashboard.layout-v2`, `dashboard.layout-profiles-v2`, and `dashboard.home-layout-sharing-v2` state. No v1 or duplicate `dashboard.widgets` state should be written.
- At phone width, test Stack, Grid, Carousel, and Focus after desktop column changes. Desktop stored columns must not create phantom mobile columns, overlap cards, or cause horizontal scrolling.
- At 100%, 125%, and 150% Windows scaling, exercise drag placement, resize preview, palette collapse, direct widget options, and keyboard nudges. Controls and grid indicators must remain reachable and unclipped.

## RC17 WIP42 Bugfix + Fossil Cleanup Pass 1 launch-convergence gate

- Create a **Game Development + Unreal Engine** Project through the normal direct-create flow. Verify the stored Project type remains `game`, the production profile remains `unreal`, Unreal production tracks/board defaults appear, and Source Control requirements/defaults match the canonical profile behavior.
- Create the same Game + Unreal Project through the provisioning flow. Compare resulting Project type/profile, board defaults, production tracks, Source Control plan, and enabled capabilities with the direct-create result. They must agree.
- Repeat parity checks for at least UEFN, ARK Mod, Minecraft Mod, and Blender profiles. No hidden specialized Project type IDs should be persisted.
- Define/use a custom Project type and select a production profile. Verify the selected profile is not silently replaced by Generic merely because the custom type ID is not a built-in purpose ID.
- Change an existing Project from a purpose compatible with its production profile to an incompatible built-in purpose without explicitly choosing a new profile. Verify the profile safely resolves to Generic instead of retaining an invalid purpose/profile pair.
- Open Projects/Operations surfaces that consume Project capabilities. Confirm Source Control, Builds, QA, Viewer, Library, Board, Whiteboard, Timeline, and delivery affordances match the canonical purpose/profile definition.
- As an administrator, load `/api/portfolio/intelligence` and its history path. Verify both work. Confirm the removed project-scoped portfolio aliases are no longer registered/used by the current renderer.
- Exercise Offline/Sync Center on a fresh WIP42 client: queue a replay-safe mutation, disconnect/reconnect, and verify normal replay/conflict handling works without a startup queue-repair pass.
- Create and edit recurring Project work. Reload and verify target kind, cadence, next run, owner label, checklist, pause state, and generated-run timing survive from the canonical top-level automation payload.
- Enroll a new TOTP authenticator, verify enrollment, sign in/reauthenticate with TOTP, regenerate recovery codes, and run any available secret-rewrap operation. All flows must use the canonical `authenticator:totp:<userId>` purpose without fallback behavior.
- Exercise lifecycle transitions backed by `assertLifecycleTransition`. Confirm removal of the unused deprecated state helpers does not affect job/lifecycle transitions.
- Create/edit a Project capsule and inspect the visible project tree. Cluster bookkeeping should remain under `.cluster/state`; no old `File Index.json`, `Review Asset Index.json`, `Timeline and Builds.json`, root `Boards.json`, or `Library Items.json` mirrors should be generated or cleaned up.
- Create an external portal/share link using only canonical section IDs (`overview`, `timeline`, `delivery`, `library`, `tickets`, `reviews`, `threads`). Verify the public portal renders the selected sections. Old aliases such as `files`, `reports`, `builds`, and `comments` must not become canonical silently.
- Exercise every compact color control you can reach in Settings/editors. Verify label, swatch, value, chevron, disabled state, hover/focus, popover placement, and mobile sheet behavior after removal of `liquid-glass.css`.
- Open Project Assets with a record that does not yet have a checksum. Verify the UI reads `Pending checksum` and checksum repair/verification behavior remains available.
- Smoke-test the application route chunks that previously sat behind the deleted compatibility barrels: Tickets, Builds, Boards, Whiteboards, Operations, Team, and Admin workspaces must still lazy-load without unresolved-module errors.
- Verify client/server version gating still rejects an incompatible client and `/api/meta/compatibility` still reports the required action. WIP42 intentionally does not remove this launch-safety contract.
- Verify People/Workforce presence, status messages, primary-team labels, and related search/profile displays still update. Their current authority mirrors are deliberately retained until all live readers are converged.
- At 100%, 125%, and 150% Windows scaling, smoke-test the compact color control and Shared Create Project purpose/profile selectors for clipping or missing controls.


## RC17 WIP43 Bugfix + Authority Convergence Pass 1 launch-authority gate

- Start from a **fresh database** through the real Windows bootstrap. Confirm the WIP43 migration applies successfully, the server reaches healthy state, and Prisma does not report unknown/missing User or WorkingPattern columns.
- Inspect the resulting schema: User must not contain title/department/teamName/manager/status/timezone/skills/expertise/workingHours/capacity/minimum/startDate mirrors; WorkingPattern must not contain capacity/minimum fields.
- Create a new person with title, department, manager, employment type, work location, start date, capacity/minimum hours, timezone, working hours, availability, status message, and skills. Reload People and Workforce; every value must round-trip from its canonical authority.
- Edit each of those workforce fields independently, reload, search, open the person detail, and verify no stale value survives from a second persistence copy.
- Create a manager chain A → B → C, then attempt C → A. The cycle must be rejected using Employment.managerUserId. Verify direct reports and manager labels update after legitimate changes.
- Put a user in two active Studio Teams and make the **secondary** team the subject of an access rule. Confirm the rule grants access. Archive that membership/team and confirm the access disappears without changing the primary-team display.
- Change a user’s primary team. Verify the People projection updates, but permissions for other active team memberships continue to work.
- Change availability/status message/invisible state. Verify WorkforceStatus is updated, presence rendering remains correct, and User only advances lastSeenAt rather than receiving a mirrored status field.
- Set a non-UTC WorkingPattern timezone and configure quiet hours/digests. Exercise immediate notifications, digest generation, and escalation scheduling. Confirm no Prisma User.timezone error occurs and timing uses the WorkingPattern timezone.
- Run the CSV user importer with a team name that already exists. Confirm the user is created and receives a real StudioTeamMember membership without creating a duplicate team.
- Repeat CSV import with a new team name. Confirm the team is created once and the imported user becomes a member. Verify /api/users does not persist a teamName column.
- Exercise People search/filter/sort/pagination, Admin People, Workforce views, privacy export/erasure preview, search indexing, scheduling, time serialization, and data-platform metrics for users that have canonical workforce records.
- Create a **Game + Unreal** Project through JSON import and normal create. Create a default Board in each and confirm Unreal production-profile board columns/defaults are used.
- Import a Project record with no type/profile. Confirm the current fallback is `general` + `generic`, not an old Unreal Project type.
- Open Project Control Center for Game, Video/Creative, external/general, and software-style Projects. Confirm template selection follows canonical purpose/profile configuration rather than string matching project names.
- Rename a Project to include words such as Unreal, ARK, Minecraft, or Fortnite while leaving Production Profile generic. Confirm build profile behavior does **not** change based on the name/description.
- Verify current Production Profile IDs such as Unreal/UEFN/ARK/Minecraft still work where they are actual profiles, while no Project row persists those IDs as `projectType`.
- Re-run client/server version-gating smoke tests. WIP43 must not disturb the current compatibility/protocol safety contract.
- At 100%, 125%, and 150% Windows scaling, smoke-test People detail/edit, Workforce, team membership editors, Project import, and Board creation to catch regressions in the current UI surfaces touched by the authority changes.

## RC17 WIP44 Bugfix + Fossil Cleanup Pass 2 launch-cleanup gate

- Start from a **fresh database** through the real Windows bootstrap. Confirm all migrations apply cleanly, including ProjectRelationship `revision`/`updatedAt`, and the removed Phase 9H data-only workflow migration is not required.
- Create a dependency in the UI and confirm the server record keeps the exact client entity ID. Reload, edit it, reload again, and verify identity remains stable.
- Repeat the identity test for recurring work. The canonical Project Control automation row must retain the client workflow ID rather than silently substituting a generated ID.
- Open the same dependency in two clients. Save from client A, then save stale state from client B. Client B must receive a revision conflict and reload current state rather than overwriting A.
- Repeat the stale-write test for recurring work and for deletes. Revision conflicts must be explicit and recoverable.
- Create/remove watchers and verify the client reconciles to the canonical subscription ID where needed; subsequent edits/removals must address the server identity rather than a stale optimistic key.
- Exercise dependency links using only canonical `source`/`target` objects. Confirm no current request or saved payload requires `fromType/fromLabel/toType/toLabel`.
- Smoke-test all seven launch Project Workflow kinds: dependency, recurring, watcher, meeting, versionSnapshot, boardView, and whiteboardComponent. No removed bridge kind should appear in current UI calls.
- In Operations → Persistence, filter and export several dynamically generated kinds such as `sharedWorkWatcher`, automation runs/versions, dashboard presets, or structure templates. Real stored kinds must no longer be rejected by a stale hard-coded enum.
- Verify Persistence inspect/list, archive, validate, lock, repair, audit, bulk status, and export still work. Confirm arbitrary generic record creation/replacement endpoints are no longer exposed.
- Enroll TOTP, verify it, reauthenticate, regenerate recovery codes, disable MFA, and sign in again. Confirm all routes operate through the Authenticator service with no `mfa-service` facade behavior.
- Register/use a passkey, including passwordless sign-in where configured. Challenge creation/claim, credential lookup, and sign-count updates must still work after direct Authenticator-service routing.
- Launch with a valid schema-2 `cluster.config.json`. Verify normal startup and Server Config save/reload.
- Try a root-level/old-shape config, wrong `version`, or wrong `secretPolicy`. Cluster must reject it clearly rather than silently translating it.
- Put a database-managed key such as `studioName` in `cluster.config.json` and run launcher setup. It must fail clearly instead of silently moving/compacting the key.
- Put a plaintext protected boot secret in `cluster.config.json`. Production startup must reject it; saving the same setting through Cluster must write the protected encrypted representation.
- Run `storage:sync` with a valid schema-2 config and then with an old/root-level config shape. Only the current schema is accepted.
- Verify a fresh/default server and the Server Config UI both report a **7-day** session lifetime. Confirm auth/MFA/service-credential/studio-security policy routes use the same fallback when no explicit value is saved.
- Override session lifetime explicitly and confirm the exact configured value is honored; there must be no hidden `30 → 7` translation.
- Re-run client/server version-gating tests. Current protocol/API/schema compatibility safety must still work; WIP44 removes historical-install shims, not live version safety.

## RC17 WIP45 Bugfix + Fossil Cleanup Pass 3 access / state-contract gate

- Sign in as a non-admin project member who has normal Whiteboard access. Open a project Whiteboard, edit it, and collaborate from a second client. The route must authorize through the canonical `whiteboards` permission and must not fall into an unknown/none permission state.
- Create/use a standalone Whiteboard as a non-admin whose role grants Whiteboards. Realtime collaboration/subscription must authorize through `whiteboards` and remain connected.
- With two clients, edit a Whiteboard and inspect delta sync. Whiteboard changes must appear through the collaboration/sync feed for users with access; users without access must not receive them.
- As a non-admin project member with Library access, open Project Assets/project files, upload or modify an allowed item, and use media/preview routes. All checks must resolve through the canonical `library` permission rather than the retired `files` ID.
- Verify an intentionally restricted member is still denied Whiteboard/Library operations. The WIP45 fix must restore legitimate access, not weaken authorization.
- Change recent colors, Admin section/handoff state, Server Config section, Shared Create recent modes, and any workspace recovery state that is practical to exercise. Reload/restart and confirm current-state persistence works using the canonical unversioned keys.
- Exercise offline sync/recovery and delta sync across a reload. Current cursor/lease/recovery state must persist normally after the key cleanup; no compatibility migration from old WIP-numbered keys should run.
- Create/edit Studio custom-field definitions and values, then navigate between Custom Fields and Operations and reload. Both surfaces must use the same canonical cache contract and remain coherent.
- Call `/api/meta/compatibility` from a compatible and deliberately incompatible client/version scenario. Current protocol/API/schema gating must still work and the response must no longer depend on an always-empty `deprecated` field.
- Navigate across current screens while behavioral analytics is enabled. Current canonical route IDs should record normally. Retired route identities such as `profiles`, `reports`, `knowledge`, and `userAdmin` must not be emitted or accepted as current screen identities.
- Open Shared Create and exercise current modes. Confirm no styling regression after removing CSS for retired `report`, `time`, and `sprint` modes.
- Re-run Privacy Choices/consent from a clean profile. `cluster-privacy-consent-v2` remains intentionally revisioned and consent persistence/synchronization must still work.
- Re-run client/server version-gating and update-required/read-only tests. WIP45 removes historical identity/state fossils, not live compatibility safety.

## RC17 WIP46 Bugfix + User Menu + Fossil Cleanup Pass 4 account / presence gate

- Open the taskbar user menu at 100%, 125%, and 150% Windows scaling. Verify the identity header, account facts, availability tiles, visibility control, message editor, grouped account actions, utility actions, and Sign out control do not clip or overlap.
- Repeat the menu check in a narrow browser/mobile viewport. The floating surface should become the normal mobile sheet and remain scrollable without cutting off Sign out.
- Set each availability state from the taskbar menu: Available, Busy, Focus, Do not disturb, and Away. Reload Cluster after each change and confirm the same state returns from WorkforceStatus.
- Set **Appear offline** while availability is Focus or Do not disturb. Confirm the current user still sees the real availability plus invisible state, while a normal second user sees the person as offline/hidden according to disclosure rules. Time records must not change.
- While invisible, change availability from the taskbar menu. Confirm visibility remains invisible and the new availability is preserved for when the user becomes visible again.
- Toggle **Become visible**. Confirm the preserved availability becomes visible again without being reset to Available.
- Edit and clear the status message in the taskbar menu. Verify People, profile peeks, current-user settings, and collaboration presence reflect the same canonical message.
- In Account Settings → Privacy & data → Presence, set Do not disturb and a message, save, reload, and verify the taskbar/People surfaces match. Account Settings must never receive an unsupported `offline` value for the current user.
- In People → My availability, change availability, visibility, message, declared status, and disclosure. Verify the calls go through `/api/me/presence` and the taskbar Account menu reflects the result after refresh/event propagation.
- Confirm `PATCH /api/me/availability` no longer exists and current renderer code makes no calls to it.
- Confirm generic `/api/users` create/update cannot mutate live presence. Create/edit a person from User Administration and verify the profile operation does not overwrite their WorkforceStatus availability/visibility.
- Inspect saved user preferences after changing presence. Presence availability/message must not be persisted as duplicate `userPresenceStatus` / `userStatusMessage` preference authority.
- Exercise Desktop presence publishing while visible and invisible. Invisible mode must clear/withhold declared work context as before; becoming visible must allow context publishing again according to disclosure level.
- As another normal user, open People/search/profile surfaces for an invisible person. Confirm private `connectionVisibility` is not exposed and the recipient sees only the masked offline result.
- Load `/api/roles` and `/api/departments` through current UI/API consumers. Confirm both work and `/api/team/roles` / `/api/team/departments` are not required anywhere.
- Exercise actual Studio Team routes (`/api/team/context`, `/api/team/teams`, `/api/team/assignments`) to confirm the Role/Department namespace cleanup did not disturb real team workflows.
- Run sync/offline mutations for self-presence. `/api/me/presence` should remain allowed; the dead `/api/users/me/status` path must not appear in queued/replayed mutations.
- Inspect `/api/meta/compatibility` and server capabilities. Current functional capability IDs and protocol/schema safety must remain; historical WIP/polish capability IDs must not return.
- Re-run login/logout, account-menu Profile/Settings/People/Admin navigation, current-view copy, Desktop detach, and server-switch actions to catch regressions in the refreshed dropdown.


## RC17 WIP47 Bugfix + Account/Profile + Fossil Cleanup Pass 5 gate

- Open Account Settings → Profile at 100%, 125%, and 150% Windows scaling. Verify the new identity hero, avatar, account context, accent control, cards, toggles, and Save Profile action do not clip or overlap.
- Repeat Profile at tablet and phone widths. The hero must collapse cleanly, controls must remain reachable, and no horizontal overflow should appear.
- Upload PNG, JPG/JPEG, WEBP, and GIF profile images through Account Settings. Confirm the image updates in the profile hero/taskbar and the upload enters the existing avatar-review workflow.
- Reject an unsupported file type and a file larger than 5 MiB. The client must refuse the upload without changing the current avatar.
- Review/approve/reject a pending self-upload from the existing admin avatar-audit surface. Rejection must still restore the previous avatar.
- Confirm current self avatar upload uses `POST /api/me/avatar`. `/api/users/me/avatar` must not exist or be required by any renderer path.
- Confirm heartbeat traffic uses `POST /api/me/heartbeat`, including normal shell activity and signed-in kiosk behavior. `/api/users/me/heartbeat` must not exist.
- Verify heartbeat updates last-seen state and that the implementation is owned by the Presence service/routes rather than User Directory.
- In Profile → Contact, leave Email empty and verify Email cannot be chosen as Preferred contact. Repeat for Phone and Discord.
- Attempt equivalent invalid preferred-contact payloads directly against `/api/me/profile`; the server must reject them with `PROFILE_CONTACT_UNAVAILABLE`.
- Set a valid preferred contact method, save, reload, and verify it persists. Then try clearing the backing contact value while it remains preferred; the server must reject the inconsistent profile.
- Toggle Show email, Show phone, Show Discord, Show timezone, and Show presence. Verify the public profile projection honors each toggle and the new switch controls remain keyboard accessible.
- In Account Settings → Privacy & data → Presence & visibility, change availability. The change must apply immediately without using the page-level Save changes button.
- Toggle Appear offline from Account Settings and verify availability is preserved while normal viewers receive the masked offline state.
- Type a status-message draft, change availability or visibility before saving the message, and verify the draft is not wiped or silently saved.
- Save and clear the status message from Account Settings. Confirm the taskbar menu and People surfaces resolve the same WorkforceStatus message.
- Inspect `/api/me/preferences` payloads after profile/presence work. `userPresenceStatus`, `userStatusMessage`, and `userTimezone` must not be persisted.
- Change Profile timezone, reload, then exercise notification quiet hours/digest scheduling. WorkingPattern timezone must drive scheduling; no preference fallback should be required.
- With no timezone configured, verify notification scheduling falls back safely to UTC rather than resurrecting a preference mirror.
- Re-run profile revision-conflict testing from two clients. WIP47 UI changes must not weaken the existing profile revision fence.
- Re-run login/logout, taskbar user menu, People profile, profile peek, search, and collaboration avatar rendering after avatar/presence changes.
- Re-run current client/server compatibility gating. WIP47 removes obsolete self-route/preference contracts, not live protocol/version safety.


## RC17 WIP48 Calendar Object Standardization + Profile Calendar Pass 1 gate

- Start from a fresh PostgreSQL database and run the full bootstrap/migration path. Confirm the new CalendarEvent authority migration applies cleanly and Prisma generates with the new fields and removed Meeting duplicates.
- Inspect the schema after migration. `CalendarEvent` must own visibility, notes, timezone, attachmentIds, decisionIds, and actionItemIds. `Meeting` must not duplicate those fields.
- Create Studio, Project, Participants, and Private objects for User A. Test main Calendar and Profile Calendar as owner A, participant B, same-project non-participant C, unrelated D, and admin. Both surfaces must agree.
- Verify unauthorized Participants/Private objects are absent from list/profile/upcoming results. Do not return `Private meeting`, busy-shell, attachment-name, participant-name, or title placeholders.
- Create Project visibility without a Project association directly through the API. Confirm `CALENDAR_PROJECT_REQUIRED`.
- Create an ordinary non-meeting Review/Deadline/Release with notes, timezone, participants, Library attachment IDs, decision IDs, and action-item IDs. Reload and confirm the shared fields round-trip from CalendarEvent.
- Repeat rich-context round-trip for a Meeting. Confirm Meeting keeps agenda/RSVP/attendance/resources but shared notes/visibility/references come from CalendarEvent.
- Supply an unavailable participant. Confirm `CALENDAR_PARTICIPANT_INVALID`.
- Supply an unavailable/wrong-project Library item. Confirm `CALENDAR_ATTACHMENT_INVALID` and verify Calendar linking cannot bypass Library/Project authorization to open the item.
- Supply an unavailable/wrong-project decision reference. Confirm `CALENDAR_DECISION_INVALID`.
- Open People → person → Calendar. Confirm the request is lazy and does not fire while using Overview/Work/Activity/Access/Full Profile.
- Keep a Profile Calendar open, edit a Calendar object in another client, and confirm only the Calendar profile data refreshes on the resource-change event rather than reloading the full People/Workforce graph.
- Test Profile Calendar at desktop/tablet/mobile widths with empty state, many events, all-day records, long titles, Project labels, visibility labels, notes indicator, and attachment counts.
- Test timezone boundaries and events around midnight in at least UTC and America/New_York.
- Verify recurrence, reminders, linked ticket, Calendar/Scheduler meeting placement, RSVP, attendance, resource reservations, stale revision conflicts, delete conflicts, and conflict-warning behavior still work after authority convergence.
- Exercise Shared Create Calendar and Project Video review-session creation. Defaults must resolve to Studio visibility without a Project and Project visibility with a Project.
- Re-run Home Calendar widgets, upcoming notifications, My Work/linked work, Scheduler, Timeline overlays, and search paths that consume Calendar records. No consumer should expect shared rich context under `meeting`.
- Re-run client/server version gating. WIP48 changes launch schema authority but must not disturb protocol/API/schema compatibility safety.


## RC17 WIP49 Bugfix + Library API Convergence + Fossil Cleanup Pass 6 gate

- Start Cluster from a fresh PostgreSQL database and verify the unchanged WIP48 schema/migration chain still applies cleanly. Migration count remains 86.
- Open Library and exercise workspace load, summary/Home Library widgets, item create/edit/archive, folder navigation, permissions, favorites, collections, search/filter, and direct item detail. All HTTP traffic must use `/api/library`; `/api/knowledge` must not appear.
- Upload a Library file, finalize the transfer, download it, open media preview, rebuild derivatives, and exercise lock/watch/review state. Generated URLs must stay under `/api/library`.
- Exercise mounted Libraries and Project Library/file consumers. File and preview URLs must resolve after the route convergence.
- Run data import/export flows that create or consume Library artifacts. Returned download URLs must use `/api/library`.
- Run Library delta sync and normal reconnect/offline recovery. The Library cursor must pull `/api/library/delta` and invalidate canonical Library cache prefixes only.
- Mutate Boards, Whiteboards, Timeline, People/Workforce, Packets, Custom Fields, Automation, Client State, and Library. Confirm cache invalidation still refreshes current routes without relying on removed singular/historical route prefixes.
- Trigger notifications targeting Scheduler, Library, and People in the native Desktop client. Clicking the notification must navigate to `scheduler`, `library`, and `people` respectively rather than retired `time`, `knowledge`, or `profiles` routes.
- Verify notification clicks carrying project context and inspector context still preserve those route segments.
- Sign in, receive native notifications, restart Cluster, and confirm duplicate-notification suppression still works with `cluster.desktop.native-notifications:<user>`. No `v473` compatibility read should run.
- Generate Activity/Notification/Search resource navigation for card-backed and project-backed events. Confirm the caller-selected canonical ID is used and no generic `fallbackId` identity guessing exists.
- Re-run `/api/meta/compatibility` with compatible/update-required/incompatible scenarios. WIP49 removes pre-launch route fossils only; live protocol/API/schema safety must remain intact.

## RC17 WIP50 Bugfix + Library Data Authority Convergence + Fossil Cleanup Pass 7 gate

- Start from a completely fresh PostgreSQL database through the real Windows bootstrap. Confirm all **87** migrations apply, Prisma generates successfully, and the resulting table is `LibraryItem` rather than `KnowledgeItem`.
- Run Database Doctor after bootstrap. The required Library read-path index must be reported as `LibraryItem_projectId_parentId_status_idx`; no false missing-index warning for `KnowledgeItem_projectId_parentId_status_idx` should appear.
- Create, edit, move, archive, restore, review, favorite, collect, lock/watch, upload, download, and preview Library items. Confirm all Prisma paths use `libraryItem` and all HTTP traffic remains under `/api/library`.
- Open Projects, Project Control Center, search, Resource Hub, Home Library widgets, Operations, mounted Libraries, and privacy data controls. Project/API payloads must expose `libraryItems`; `knowledgeItems` must not appear.
- Trigger Library create/update/archive/bulk activity and notifications. Activity resource identity must be `library`; bulk activity must carry affected Library IDs in metadata rather than a fake comma-delimited resource ID.
- Exercise data import/export paths that create or reference Library artifacts. Activity, URLs, cache invalidation, and search indexing must all use the canonical Library identity.
- Exercise Library copyright reporting, disable-access, counter-notice/restore, and external/share projections. Copyright resource type must be `library`; `knowledge_item` must not be accepted or emitted as the Library resource type.
- Perform Library edits across two clients plus reconnect/offline recovery. Delta sync and conflict/cache classification must react to `library` only and must not rely on a `knowledge` entity alias.
- Trigger native/server notifications for Library records. Notification tool inference must resolve canonical Library/file/asset kinds without requiring a historical `knowledge` Library kind.
- Export personal privacy data for a user who owns and reviews Library items. Export schema must be **5** and collections must be named `libraryOwned` / `libraryReviewing`; no `knowledgeOwned` / `knowledgeReviewing` collections should be emitted.
- Confirm current source and live payloads contain no Library compatibility identities `KnowledgeItem`, `knowledgeItem`, `knowledgeItems`, `knowledge_item`, `knowledge-bulk`, `/api/knowledge`, or `git-knowledge`.
- Separately verify **Studio Knowledge** still works: required Packet/Policy assignments, `/api/my-knowledge`, Studio Knowledge compliance/operations, and knowledge-type Packets must remain functional. These are current domain concepts, not Library aliases.
- Verify password/PIN reauthentication and high-risk security verification still recognize the `knowledge` factor strength. WIP50 must not confuse authentication terminology with the removed Library identity.
- Re-run `/api/meta/compatibility` with compatible, update-recommended, update-required, and incompatible clients. Current protocol/API/schema compatibility safety remains required.

## RC17 WIP51 Bugfix + Runtime State Contract Fossil Cleanup Pass 8 gate

- Open two normal Cluster tabs for the same account, queue an offline-safe mutation, reconnect, and verify only one tab acts as sync leader. The Web Locks identity must be `cluster-sync` and must coordinate with the stable `cluster-sync-lease` fallback rather than a WIP-numbered lock.
- In browsers without Web Locks, repeat the two-tab reconnect test and verify the localStorage lease fallback still prevents concurrent replay.
- Inspect IndexedDB after normal offline use. The database must be `cluster-offline`, schema version **3**. No runtime code should open `cluster-offline-v273`.
- With two tabs, create/resolve offline queue activity and verify cross-tab refresh uses the `cluster-offline` BroadcastChannel. Pending/conflict/upload counts should converge without duplicate replay.
- Exercise cross-window cohesion events such as resource changes/navigation refresh and confirm the stable `cluster-cohesion` channel propagates them.
- Navigate long workspaces, scroll, switch away/back, and reload. Current session scroll restoration must work through `cluster-scroll:` / `cluster-route-scroll:` keys with no old-key fallback.
- Open Shared Create, enter a meaningful draft, close/reopen, and verify draft recovery uses `cluster-shared-create:<userId>`. Discarding/creating must clear the same canonical draft.
- Navigate through several workspaces and reopen recent navigation. Server state must use `navigation.recent`; `navigation.recent-v495` must never be read or written.
- Change Notification Inbox view-rule toggles, reload, and verify the settings persist under `notifications.view-rules` only.
- Edit the Home note, reload, and verify it persists under `dashboard.note` only.
- Toggle Whiteboard autosave with preference consent enabled, reload, and verify `cluster-whiteboard-autosave` is stored and honored. Revoke preference consent and verify cleanup/denial uses the same canonical key.
- Open Privacy Choices / privacy inventory and confirm the server inventory names `cluster-whiteboard-autosave`, while consent itself remains the intentionally versioned `cluster-privacy-consent-v2` schema-2 contract.
- Trigger a live notification from the in-app notification stream while Desktop notification sync is active. The producer and consumer must communicate through the centralized `cluster-live-notification` contract and native delivery must occur once.
- Mark notifications read and confirm live preview/native recovery refresh through the centralized `cluster-notification-read-state-changed` contract.
- Create/update Studio custom-field definitions/defaults and run Studio Automation actions. New persistence records must use semantic `custom-field-defaults`, `custom-field-api`, and `studio-automation` source keys without WIP suffixes.
- Create/run Project Automation and save a Project structure template. New persistence records must use `project-automation` and `project-structure-template`.
- Inspect Persistence/Operations dedupe and validation views after the source-key cleanup. Current records must group normally and no route should require old WIP-numbered provenance values.
- Exercise Scheduler shift-rule settings and time-correction flows after the `DEFAULT_SHIFT_RULES` source-symbol cleanup. Runtime behavior and persisted `time.shift-rules` data must be unchanged.
- Verify current shared package exports no `EXTERNAL_PROJECT_ACCESS_RULES_V126`. Project/external authorization must continue through the actual current authorization engine, not that removed snapshot.
- Re-run backup verification, encrypted storage/file handling, privacy consent, Home layout schema 2, and `/api/meta/compatibility`. Their genuine schema/protocol version markers must remain intact.
- Read the packaged `README.txt` and confirm it identifies **RC17 WIP51**, not the stale WIP42 text that survived earlier packages.



## RC17 WIP52 Bugfix + Custom Field / Automation Authority Convergence + Fossil Cleanup Pass 9 gate

- Sign in as User A, load Custom Fields containing sensitive values, sign out, then sign in as User B. Simulate an API failure/offline reload. User A's Custom Field definitions or values must never reappear from browser persistence; no Custom Field localStorage/sessionStorage read authority should exist.
- Repeat the account-switch test across normal sign-out, session expiry, and Desktop reconnect. Custom Fields must fail closed when the server cannot authorize the current account.
- Create a required boolean Custom Field and save both `true` and `false`. Both are valid populated values. Only an actually absent value should fail required validation. Test both Project/Ticket-style panels and Calendar `EntityCustomFields`.
- Create fields with Everyone, Members, Managers, and Admins view/edit policies. Verify `visibleFieldIds` and `editableFieldIds` from `/api/custom-fields/values` match the current target's real authorization, not a generic renderer role guess.
- Test the same Custom Field definition against two Projects where the same user has different target access. The UI must change visibility/editability per target and the server must reject unauthorized direct writes.
- Disable/archive a Custom Field that already has stored values. Verify single-target reads and `/api/custom-fields/values/query` omit the disabled field's stored values. Re-enable it and verify authorized values return normally.
- Attempt to save a definition with view access stricter than edit access, such as `viewAccess=admins` and `editAccess=members`. The definition must be rejected.
- Bypass the renderer and attempt a direct value write against a malformed/injected field contract whose edit access would be broader than view access. Server defense-in-depth must require the stricter access level.
- Verify every `editableFieldId` returned for a target is also effectively viewable to that caller; no blind-write-only field should exist.
- Exercise Calendar Event Custom Fields specifically. `EntityCustomFields` must use server-projected visibility/editability and must not assume a default `managers` access level.
- Exercise Ticket and Project Custom Fields after the permission convergence, including conditional visibility (`showWhenFieldId`), required validation, select/multi-select/boolean/URL/duration fields, queued writes, revision conflicts, archive, and purge behavior.
- Disconnect after a successful Custom Field load and perform an offline-safe edit through the supported mutation queue. Reconnect and verify the queued mutation follows normal conflict/revision handling; no removed browser value cache is required for replay.
- Open Studio Settings → Custom Fields with a normal non-admin and an admin. Definition visibility and archived-field behavior must remain permission-safe after removal of renderer-owned cached defaults/counts.
- On a fresh database, open Custom Fields and verify the server still establishes the intended launch defaults. The renderer must not synthesize a second default list.
- Open Studio Automation on a fresh database. The server default rules should appear; the renderer must not fabricate its own defaults while the request is pending or failed.
- Create/edit Studio Automation rules for every supported trigger. Unsupported arbitrary trigger strings must fail shared/server validation rather than being normalized into a current rule.
- Run Studio Automation actions that assign Custom Fields. Verify target access, current Custom Field definitions, revisions, queue behavior, and audit/activity records still work after contract tightening.
- Corrupt or remove the Studio Automation persistence record in a disposable test database and verify the server's explicit corruption/default handling is safe; no old rule-shape compatibility normalizer should run.
- Exercise Account Settings, Studio Settings, and Server Config routes. Removing the dead dependency-manifest exports must not break lazy loading or settings navigation; canonical dependency modules remain authoritative.
- Re-run Boards, Whiteboards, Projects, Tickets, Calendar, Home/Operations, notification approvals, owner recovery, and pinned Projects. Source-symbol renaming must not change runtime behavior.
- Inspect current TS/TSX source and confirm implementation-version symbol names are absent. Do not treat versioned CSS selector names as a runtime compatibility contract in this gate.
- Re-run `/api/meta/compatibility` with compatible, update-recommended, update-required, and incompatible clients. WIP52 removes pre-launch renderer/runtime fossils only; current client/server version gating remains required.

## RC17 WIP53 Bugfix + Access Authority Convergence + Fossil Cleanup Pass 10 gate

- Create Library access rules and verify the canonical target kind is `library` end-to-end through rule CRUD/explain, Library reads, search, comments, collaboration, and background-job authorization.
- Send `targetKind=document` directly to the current access API. It must be rejected; no pre-v1 Library target alias should remain.
- Create a Studio Team access rule from Project Access. Verify the stored `subjectId` is the immutable Studio Team ID and the server-derived `subjectName` is display-only.
- Rename that Studio Team and verify access remains correct without rewriting the rule. Authorization must follow the Team ID, not the old or new name.
- Verify active secondary Studio Team memberships are honored by Team rules. Remove the membership and confirm access disappears immediately through the normal authorization path.
- Attempt to create Team rules for archived, missing, or wrong-workspace Teams. The server must return `ACCESS_SUBJECT_INVALID`.
- Attempt to create member rules for missing, archived/privacy-erased, or wrong-workspace users. The server must return `ACCESS_SUBJECT_INVALID`.
- Supply a forged/client-selected `subjectName` while creating a member or Team rule. The server must derive its own label; PATCH must not permit relabeling subject identity.
- Create an `external` rule and verify it applies to all external collaborator accounts and does not fuzzy-match internal display names, usernames, or email substrings.
- Create a rule for a specific external collaborator using `member` and verify only that account receives the member-specific grant/deny.
- Attempt to create or PATCH contradictory rules such as `effect=deny, level=manage` and `effect=allow, level=none`. Stored state must canonicalize to `deny/none` and a valid allow level respectively.
- Flip an existing deny rule to allow without sending `level`. It must become `allow/view`, not `allow/none`.
- Give a user Project access but deny one embedded Board. Fetch `/api/projects` and verify the Board is absent from the embedded collection with no title/metadata/count shell leak. The dedicated Board route must agree.
- Repeat the child-projection test for Whiteboards. Target ACL evaluation through the Project projection and dedicated Whiteboard route must agree.
- Test allow-list style child rules where applicable and verify only authorized Boards/Whiteboards are serialized.
- Repeat Project child projection as an administrator and confirm intended admin access still returns the children.
- Re-run `/api/meta/compatibility` with compatible, update-recommended, update-required, and incompatible clients. WIP53 removes pre-launch ACL compatibility fossils only; current client/server version gating remains required.



## RC17 WIP54 Security + Access + Account Lifecycle Convergence gate

- Offboard a normal member with active Project membership, Library ownership/review responsibility, open Card assignment, Review responsibility, unresolved comment assignments, future non-private Calendar objects, trusted devices, MFA/passkeys, recovery codes, and live sessions. Confirm every live authority is transferred or retired as documented.
- Offboard a workspace owner. Without a handoff, execution must fail. With an active handoff, owner membership must transfer before the departing WorkspaceMember is removed and owner recovery must point to the new owner.
- Attempt to choose suspended, disabled, archived, expired, or self accounts as an offboarding handoff. Each must be rejected.
- Verify private Calendar objects owned by the departing user are not silently transferred to the handoff user. Non-private future events and meeting organizer authority should transfer.
- Verify direct member Access Rules for the departing user are archived and do not reactivate if the account is later restored.
- Suspend an active account with open sessions/security grants. Sessions and verification grants must be revoked and authentication/verification generations incremented. Reactivation may retain enrolled devices/authenticators.
- Disable an active account. In addition to suspension behavior, trusted devices/authenticators must be revoked and recovery/challenge material removed.
- Set `accessExpiresAt` in the past for a normal user and an administrator. The next authenticated request must revoke the session, clear cookies, return `ACCOUNT_ACCESS_EXPIRED`, and stop normal background request churn.
- As a non-owner admin, attempt password reset/set, PIN set/reset, authenticator reset, suspend/disable, and Discord unlink against an owner account. Each must fail with `OWNER_ACCOUNT_REQUIRES_OWNER`. Repeat as an owner and confirm intended actions work.
- Verify suspended/disabled/privacy-erased accounts do not receive new inbox deliveries/digests/broadcast mentions and cannot be newly selected as Calendar participants or comment assignment targets.
- Confirm archived historical comments/activity/audit evidence still retain historical attribution while live authority is removed.
- Re-run `/api/meta/compatibility` compatible/update-required/incompatible scenarios. Lifecycle hardening must not remove current client/server safety.

## RC17 WIP55 Contract + Fossil + Data Authority Convergence gate

- Create Project/Board/Whiteboard/Library/File/Review Asset Access Rules and confirm these are the only accepted direct AccessRule target kinds. Attempts to create direct Card, Ticket, Calendar, Timeline, Scheduler, Build, QA, Release, Control, or Meeting rules must be rejected by the current Access API.
- Deny a Board while retaining Project access. Verify Board Cards disappear consistently from Board realtime presence/actions, Team/My Work assignments, Project summaries, Project Intelligence, resource-change invalidations, comment mention eligibility, and other aggregate projections.
- Give a user Boards access but no Tickets access. Verify Tickets do not appear in Team assignments, Calendar due-card projections, Project relationships/counts, Project Intelligence, resource-change invalidations, public/admin filtered surfaces, or realtime Card references. Normal Cards on the same Board should remain visible.
- Add/remove a `ticket` label from a normal Card and remove/add it to a real Ticket. Authorization and Ticket identity must continue to follow `workItemKind`, never label text.
- Create Studio, Project, Participants, and Private Calendar events owned by User A. Test as owner, participant, same-Project non-participant, unrelated user, and admin across main Calendar, Timeline, Team assignments, Custom Fields, Activity/Search, Project relationships, Project Intelligence, Scheduler linkage, generic resource access, and `/api/changes`. All surfaces must agree with the canonical Calendar visibility evaluator.
- Confirm unauthorized private/participants Calendar events are completely absent from Project Intelligence counts/nodes/edges, Activity projections, Team assignment payloads, relationship summaries, Custom Field values, and resource-change invalidation streams. Do not emit placeholder IDs/titles.
- Attempt to link/edit a private Calendar event through Scheduler/production-window flows as a same-Project non-owner. The operation must be denied before mutation.
- Deny individual Boards/Whiteboards/Library items/Files, then fetch Project Intelligence. Counts, readiness inputs, graph nodes, relationships, blocker summaries, Activity, and traceability must omit unauthorized children before derivation.
- Open Project Intelligence as two users with different child ACLs in rapid succession. User-specific snapshots must not cross-contaminate through the shared Project read-model cache.
- Remove Builds permission while keeping Project access and fetch Project Intelligence. Build-derived delivery lifecycle/readiness/history/orchestration metadata must not leak through the aggregate response.
- Create a relationship whose source or target is a child hidden from the viewer. Project Intelligence must drop the relationship rather than recreate the hidden endpoint as a placeholder node.
- Exercise comment mentions on Card/Ticket targets under Board denies and Tickets-tool denies. Mention eligibility must follow parent Board + Tickets authority and must not query unsupported Card/Ticket AccessRule rows.
- Exercise Library entity comments and Custom Fields. The canonical ACL target must be `library`; direct `document` access-target vocabulary must not reappear.
- Upload a normal Library file with `visibility` and `classification` set independently. Verify each field persists independently and changing one does not rewrite the other.
- Create Library objects with workflow `status`, governance `lifecycleState`, source `source`, and provenance `originKind` combinations that differ legitimately. Serializers/governance must read the canonical field directly rather than falling back to a neighboring concept.
- Create folders/files through the Desktop mounted-Library path. New records must explicitly carry `lifecycleState=active`, `classification=internal`, and `originKind=desktop-mount`; they must not rely on Prisma defaults that contradict `source=desktop-mount`.
- Attempt `POST /api/automation/events`. The generic event-injection endpoint must not exist. Real Studio Automation triggers must continue to fire through trusted server event bridges/domain routes.
- Run Studio Automation for Ticket/Calendar/Build/QA/Release flows after removal of the generic injection endpoint and verify normal trusted triggers, dedupe, audit, and queued jobs still operate.
- Exercise `/api/changes` and its SSE stream with Board-denied Cards/Tickets and private Calendar events. Unauthorized resource IDs must never be emitted merely as invalidation metadata.
- Re-run `/api/meta/compatibility` for compatible, update-recommended, update-required, and incompatible clients. WIP55 removes pre-launch contract fossils only; current protocol/API/schema safety remains mandatory.
- Do not squash the 87 pre-launch Prisma migrations from this lean package. Perform the eventual v1 baseline only from the full dependency-backed source tree, then verify `prisma generate`, migration deploy, a completely fresh PostgreSQL database, first-run setup, Database Doctor, and the full runtime certification matrix.


## RC17 WIP56 Runtime + Performance + UX Launch Hardening gate

- Run one signed-in idle client on Home for at least 10 minutes. Record request counts by route and server log volume. There must be no one-minute editable-mirror debug spam and no unexplained repeating write/reconciliation traffic.
- Open two or more tabs for the same account/workspace. Verify only the elected offline-sync leader performs each idle health/delta cycle and follower tabs receive posture without immediately scheduling duplicate network work. Repeat after focus/visibility changes.
- Queue an offline mutation and upload. Verify urgent queued work bypasses idle coalescing/backoff, reconnects promptly, replays once, and all tabs converge afterward.
- Disconnect the server for several minutes with the client visible. Confirm resource-change and notification streams use bounded reconnect backoff instead of fixed 2–5 second loops. Restore the server and verify online/focus recovery reconnects immediately.
- Keep the notification stream healthy with the Inbox open. Confirm new stream frames refresh the Inbox promptly and that the four Inbox projections are not blindly refetched every minute. Break the stream and confirm the fallback reconciliation still recovers.
- Open Board and Whiteboard collaboration, then force stream degradation. Verify collaboration changes still reconcile while the full-object recovery poll is no faster than once per minute and hidden tabs stop polling.
- Exercise Calendar changes from another client. Resource-change events should refresh promptly; the two-minute safety reconciliation must recover a deliberately missed event.
- With the Desktop client, monitor native transfers. Push updates must update Sync Center immediately without a parallel 15-second poll. Hide/minimize the Desktop window and confirm native-service reconciliation timers stop waking it.
- Keep Desktop Workstation open with no Git/tasks running and verify status/operation polling is approximately 30 seconds. Start a Git/task operation and confirm progress switches to the two-second active cadence until completion, then returns to idle cadence.
- Leave editable Project/User/Library mirrors unchanged for at least 15 minutes. Confirm the server background task reports idle/backoff behavior and does not scan/log every minute indefinitely. Externally edit a supported mirror and verify it is still detected within the bounded five-minute idle window.
- Force failures during database bootstrap, schema verification, listen, and post-listen readiness. Each startup must drain/close resources and the Node server process must terminate with failure instead of remaining alive with only `process.exitCode=1`.
- Start/stop/restart Cluster repeatedly through the native Windows control panel. After each stop, verify all Cluster-owned Node and PostgreSQL processes terminate. Native host process-tree cleanup is a runtime gate because native launcher source is not part of the lean package.
- Test the shared icon set and sidebar/taskbar at Windows 100%, 125%, and 150% scaling. Verify no Coolicons artwork is clipped, especially close/chevron/star/navigation icons. Check both compact and expanded sidebar modes.
- Test desktop widths, ultrawide, tablet, mobile, and narrow landscape layouts for sidebar/taskbar overflow, modal/drawer clipping, Home widget drag/resize, and touch targets. Capture any remaining visual regression for WIP57 bugfix-only work.
- Verify Save-Data/slow-2G mode uses the slower idle sync cadence while queued writes remain safe and user-requested forced uploads can still proceed.
- Re-run compatible/update-recommended/update-required/incompatible client scenarios. WIP56 must not weaken `/api/meta/compatibility`, read/write gating, or queued-mutation replay safety while reducing background requests.

## RC17 WIP57 v1 integration certification gates

### Desktop / Git source-control broker

- Build the forward-ported Qt/Desktop workstation source from the reconstructed master rather than substituting the WIP56 opaque native binary.
- On a clean workstation, clone and attach an Unreal repository through Cluster Desktop.
- Verify repository status, branch/upstream/remotes, stage/unstage, commit/amend, fetch/pull/push, diff/history, stash, conflict handling, and cancellable operation progress.
- Verify Git LFS health, recommended Unreal `.gitattributes`, binary-asset lock acquire/release/list, and lock-owner display.
- Disconnect networking during active local work, continue making local changes, reconnect, and verify no duplicate or lost operation is replayed.
- Verify Git credentials remain in the workstation credential boundary and are never exposed to Unreal, renderer logs, Cluster APIs, or exported settings.

### Unreal Engine Cluster Source Control provider

- Install the current ClusterSourceControl plugin into a clean supported UE5 project and enable it without editor startup errors.
- Connect through the local Desktop Workstation source-control service; when Desktop is absent, display a useful degraded/offline state instead of hanging the editor.
- Verify `.uasset` and `.umap` status appears through normal Unreal source-control surfaces.
- Lock a binary asset from workstation A and prove workstation B sees the lock owner and cannot silently claim an incompatible edit flow.
- Exercise add/delete/revert/commit/sync/history/diff paths that the provider exposes; all Git execution must occur through Desktop.
- Restart Unreal and Desktop independently and verify repository/provider state reconverges.
- Repeat against every Unreal Engine version declared supported by the v1 plugin; isolate version-specific API adaptations inside the integration.

### Discord application / bot

- Register the command manifest in a clean test guild and verify `/cluster help` and `/cluster status` respond without Message Content, Presence, or Guild Members privileged intents.
- Link a Discord account to a Cluster user and bind the guild to the expected Cluster workspace.
- Bind a Discord channel to a Project and verify protected reads are authorized by Cluster, not by Discord role names alone.
- Create a Ticket from a Discord message context action and preserve the originating message/channel URL/context in audit-safe metadata.
- Publish a build/QA/project notification through the outbound delivery path and verify retry/dead-letter evidence on a forced Discord failure.
- Attempt the same Project command as an unrelated/unauthorized Discord user and verify no private Project metadata is emitted.
- Revoke/suspend/expire the linked Cluster account and verify Discord access disappears immediately enough to satisfy normal Cluster authorization rules.
- Confirm no flow requests or accepts a Cluster password, Security PIN, passkey secret, recovery code, or Discord bot token through chat commands.



## RC17 WIP57 Pass 3 Projects / Workstation / integration gate

- Create a Project through the shortened primary flow using internal name, purpose, Production Profile, and Project Lead. Confirm the Project is usable without opening Advanced settings.
- Create another Project with external/public name, codename, and aliases; verify search/data views surface those identities without replacing the internal canonical name.
- Attempt to PATCH a Project directly to `completed` or `cancelled`. The generic mutation must reject the terminal transition and direct the client to Closeout/lifecycle authority.
- Cancel a Project through the explicit lifecycle action. A non-empty reason is mandatory, revision fencing must apply, and the audit/activity record must retain the reason. Reactivate only through the explicit lifecycle path.
- Build the promoted Go helpers with the official Go 1.27 toolchain and build Qt Desktop with Qt 6.11.2/CMake 3.31+; do not certify native parity from the compatibility compiler checks alone.
- Launch Desktop and confirm the Workstation helper binds only to loopback on an ephemeral port, writes its discovery record with restrictive per-user permissions, and rejects requests without its bearer token.
- Kill/restart the Workstation helper and confirm Desktop retires stale discovery state and publishes the replacement endpoint without forcing Unreal to guess a port.
- Attach/clone a repository through Desktop, exercise status/diff/history/fetch/pull/push, and verify long-running operations can be observed and cancelled.
- Enable Git LFS, acquire/release a binary-asset lock, and verify lock ownership is consistent between Desktop and the raw repository.
- Stage a test private-key marker and run the native secret scan. The operation must block and the response/logs must not echo the secret material.
- Load the Unreal plugin and confirm it rejects non-loopback/tampered discovery, rejects an incompatible Workstation protocol, authenticates valid local requests, and degrades cleanly when Desktop/Workstation is unavailable.
- Do not call the Unreal integration complete until a real `ISourceControlProvider` exposes status/operations/history/diff/LFS locks in the editor and passes the two-workstation Unreal gate.
- Configure Discord, link a Discord user to a Cluster user, route a Project channel, and run `/cluster status`. A linked user with Project access succeeds; an unlinked or unauthorized user receives no Project-private data.
- Create a Ticket using the Discord message context action. Repeating the same interaction/source message must not create a duplicate Ticket.
- Revoke the user's Cluster Project access and repeat the Discord command/action; access must disappear immediately because Cluster authorization remains authoritative.
- Verify the Gateway sidecar uses zero privileged intents and cannot call protected Cluster relay APIs without the separate configured relay secret.

## RC17 WIP57 Pass 4 Unreal provider / action-row gate

- Build `ClusterSourceControl` against the supported Unreal Engine 5.8 toolchain. Static source checks are not a substitute for this gate.
- Enable **Cluster** in Unreal Source Control and confirm the provider resolves the trusted repository containing the active `.uproject` through Desktop Workstation discovery.
- Request state for a clean tracked `.uasset`, a modified asset, an added file, a deleted file, a conflicted file, and an ignored path. Clean requested files must remain represented rather than disappearing from the result set.
- With two linked users/workstations, acquire an LFS lock on a lockable `.uasset`/`.umap`. The owning editor must report checked out by self and the second editor must report the real other-user lock owner and prevent the unsafe checkout path.
- Exercise Connect, Update Status, Mark for Add, Delete, Revert, Check Out, Check In, and Sync from Unreal. Verify every repository mutation is executed by Desktop Workstation and no Git credential is stored by the plugin.
- Stop Desktop/Workstation while Unreal is open. Provider operations must fail cleanly, keep the editor usable, and recover after authenticated discovery is republished.
- Test source-control UI and shared action rows at Windows 100%, 125%, and 150% scaling plus narrow desktop and phone-width responsive surfaces. Dialog footer actions must wrap without overlap; icon buttons must retain their hit target; text actions must not become unreadable slivers.

## RC17 WIP57 Pass 5 Project Snapshot / SCM operation gate

### Project Snapshot convergence

- Test as owner/admin, ordinary internal user, Project member, unrelated user, and contractor/external account.
- For each visible Project, compare Portfolio, Project Detail/Overview, Home, My Work, and Operations. Readiness, health, schedule, and external-safe display identity must agree wherever the same fact is shown.
- Verify an external collaborator sees the external/public Project name when configured and cannot recover the internal name or codename from `/api/projects`, `/api/projects/snapshots`, Home, My Work, Operations, or Project Detail.
- Remove People visibility from a user and verify snapshot lead/team identity is omitted rather than inferred client-side.
- Create Studio/Project/Participants/Private Calendar events and verify only Calendar events authorized by the canonical Calendar evaluator can appear as `nextCalendar`.
- Exercise empty Projects, ready Projects, incomplete setup, overdue targets, due-soon targets, failed builds, QA attention, no build, multiple builds, and Projects with no future milestones.
- Verify detailed Overview counts still honor child-resource authorization and do not incorrectly inherit the compact snapshot as a substitute for per-resource filtering.
- Capture request/query telemetry while opening Portfolio, Project Detail, Home, My Work, and Operations. Snapshot convergence should reduce duplicated summary computation without causing a new polling loop.

### Workstation asynchronous SCM

- Start fetch, pull, push, and commit through `operation.start`; poll `operation.status` and verify progress reaches a terminal state.
- Cancel a long-running operation and verify the Git child process receives cancellation, operation state converges to cancelled/failed safely, and no second mutation is replayed.
- Attempt to read/cancel an operation through a different trusted repository ID. The request must return operation-not-found rather than leaking or controlling the other repository's work.
- Restart Desktop/Workstation during a non-authoritative background operation and verify repository state is reconstructed from Git rather than trusting stale in-memory operation state.
- Keep the workstation idle and verify async operation support does not introduce high-frequency polling when no operation is active.

### Asset history / revision diff

- Create an asset, rename it, edit it across several commits, and request history for the asset path. Single-path history must follow the rename chain and omit unrelated commits.
- Request history for multiple paths and verify results are scoped to those paths without exposing arbitrary repository-wide history.
- Diff an asset between two known revisions and verify the returned patch corresponds to those revisions.
- Attempt revisions beginning with `-`, containing whitespace/newlines, or otherwise outside the accepted revision grammar. Workstation must reject them before Git execution.
- Exercise staged and working-tree diff with no explicit revisions and verify existing behavior remains intact.

### Discord delivery state

- Force transient Discord delivery failures below the maximum-attempt threshold and verify Operations reports them as retrying, not dead-letter.
- Exhaust the delivery attempt ceiling and verify the receipt is reported as dead-letter with failure evidence.
- Use the admin-authorized manual retry path and verify it enqueues durable delivery work rather than directly sending from the request thread.
- Confirm the transport sidecar still requests no privileged Gateway intents.

## RC17 WIP57 Pass 6 Unreal async / revision / Desktop bridge gate

### Unreal provider compile + initialization

- Compile `ClusterSourceControl` against the supported Unreal Engine 5.8 toolchain and verify both provider initialization paths satisfy the current engine API.
- Enable Cluster Source Control with and without **AttemptConnection**. A non-connection initialization must not hang or force unnecessary repository work; a requested connection must resolve the trusted Desktop repository and return accurate availability/status settings.
- Start Unreal without Desktop/Workstation, then start Desktop later. The provider must remain usable, report degraded/unavailable state correctly, and reconverge without editor restart.

### Async operation lifecycle

- Run a long pull/sync and a long check-in/push from Unreal. The editor UI must remain responsive while Workstation owns the Git process.
- Verify completion callbacks are delivered exactly once after the Workstation operation reaches a terminal state.
- Cancel an active Unreal source-control operation and verify Workstation receives cancellation, the child Git process is stopped safely, and Unreal reports cancelled rather than success.
- Stop/restart Workstation during an active operation. Unreal must receive a bounded explicit failure and remain usable; no stale in-memory operation may be replayed as a second mutation.
- Verify no idle high-frequency polling remains after all operations are complete.

### Revision/history/diff

- Request Update Status with history for an asset changed across several commits and a rename. Unreal history must show only the path-relevant Workstation history and preserve the rename chain where supported.
- Select historical revisions through Unreal's revision/diff surfaces and verify `ISourceControlRevision::Get()` materializes the exact requested bytes through Workstation.
- Confirm materialized files are written beneath the protected per-user Workstation revision cache, are reusable when cached, and are not created outside that boundary.
- Attempt invalid revision strings and unsafe/out-of-repository paths. Workstation must reject them before Git invocation.
- Verify binary `.uasset` / `.umap` revision retrieval does not alter the working tree or acquire/release LFS locks.

### Native Desktop Workstation bridge

- Build Qt Desktop with the official Qt 6.11.2/CMake toolchain and verify native source-control actions use the authenticated Workstation `/v1/source-control/actions` boundary.
- Exercise native Desktop status/history/diff plus at least one mutation and prove Desktop and Unreal observe the same repository/lock state.
- Inspect logs/IPC traffic and verify bearer tokens, Git credentials, and secret material are never emitted.

### Certification hold

- Do not lift the Desktop `0.482.0` source-version hold or call the Unreal provider certified until the official Go 1.27, Qt 6.11.2, UE 5.8, two-workstation LFS, DPI, and Windows process-lifecycle gates all pass.



## RC17 WIP57 Pass 7 Desktop Workstation / Discord gate

- Start a long Git operation from the Desktop workspace. Confirm operation progress updates promptly from native `workstation.operations.changed` events without a repeating 2-second renderer request loop.
- When all Git operations become terminal, leave Desktop idle for at least 60 seconds and confirm the native operation monitor stops issuing operation-list requests.
- Kill/restart the Workstation helper during an active operation view. Confirm the renderer falls back to slow safety reconciliation and the helper can recover without exposing repository paths or credentials.
- Run clone, fetch, pull, push, LFS lock/unlock, and a commit with push. Verify stage/progress text advances meaningfully and never reports 100% before terminal success.
- Cancel a cancellable Git operation. Confirm Desktop reaches cancelling/cancelled and no orphan Git process survives.
- With a Discord-linked Cluster user, verify ACTIVE access succeeds. Then test SUSPENDED, DISABLED, expired access, and archived user state; each protected Discord action must be rejected immediately.
- Archive a Project while leaving an old Discord route binding present. The channel must no longer resolve that Project for status/Ticket actions.
- Rotate the Discord relay secret using current + `CLUSTER_DISCORD_RELAY_TOKEN_PREVIOUS`. Confirm both secrets work only during the rotation window, then remove the previous token and verify the old secret is rejected.
- Re-run the live-guild idempotency, retry/dead-letter, unauthorized-user, and revoked-access certification matrix before calling Discord v1-ready.


## RC17 WIP57 Pass 8 native parity / private runtime gate

### Workstation artifact identity

- Build Workstation on Windows with official **Go 1.27.1+** using `GOTOOLCHAIN=local`. The build must produce `cluster-workstation-service.exe` plus `cluster-workstation-service.manifest.json`.
- Run `npm run native:workstation:verify`; manifest Cluster version, protocol, file size, and SHA-256 must match the built helper.
- Replace the helper with a modified/truncated file and verify Desktop refuses to start it before any authenticated IPC request is sent.
- Put a stale discovery record from another Cluster version/protocol in the Workstation state directory. Desktop must reject/retire it rather than reusing the endpoint/token.
- Crash Workstation without deleting discovery JSON, then restart Desktop. Desktop must health-probe the stale endpoint, retire it, and start a valid helper.

### Private Git/Git LFS runtime

- Stage pinned Git for Windows **2.56.0** and Git LFS **3.8.0** under the release `bin/runtime` layout and run `npm run desktop:runtime:verify`.
- Launch Desktop on a clean Windows account with no system Git on PATH. Workstation must report `gitRuntime=bundled`; clone/status/fetch/pull/push/commit/history/diff and LFS lock/unlock must work.
- Temporarily remove the private runtime in a development build with system Git installed. Workstation may report `gitRuntime=system`, but the official Windows packaging command must refuse to produce a package without the staged private runtime.
- Verify Git/LFS executable paths are never exposed to the renderer/Unreal response contract; only runtime provenance/health may be surfaced.
- Verify private Git child processes terminate on cancellation, Desktop shutdown, and Workstation crash recovery.

### Qt package/runtime identity

- Build the reconstructed Desktop with Qt **6.11.2** and the required current security fixes/advisories applied by the release environment.
- Verify CMake rejects a Workstation manifest with the wrong Cluster runtime version or source-control protocol.
- Verify the packaged Desktop contains the Workstation helper manifest and private Git/Git LFS runtime.
- Re-run 100%, 125%, and 150% Windows scaling, helper restart/recovery, source-control operation event delivery, and no-orphan-process gates.

### Hold

Do not lift the Desktop `0.482.0` source-version hold until these tests plus the existing UE 5.8 and two-workstation LFS gates pass on real Windows machines.

## RC17 WIP57 Pass 9 Visual Foundation / Shell gate

### Appearance resolution

- Exercise Light, Dark, and System themes with Clean, Gradient, Aurora, and Midnight background bases.
- Exercise None, Hex, Grid, and Dots patterns independently of the background base. Confirm changing the base does not silently change the selected pattern and vice versa.
- Verify pattern intensity at 0%, default 4%, and maximum 12%; pattern contrast must remain subordinate to readable content.
- Verify Small, Medium, and Large pattern scale at 100%, 125%, and 150% Windows scaling without seams, clipping, or visibly broken hex joins.
- Switch Flat, Outlined, and Glass panel modes. With transparency accessibility disabled, Glass must resolve to the opaque/outlined equivalent rather than remaining translucent.
- Exercise Sidebar and Taskbar Match / Solid / Glass independently and verify the resolved visual context remains stable after reload/sign-in.

### Taskbar navigation/recovery

- Confirm Back and Forward are available in web and Desktop sessions and follow real navigation history.
- Verify Alt+Left and Alt+Right navigation without stealing focus/keystrokes from text entry or modal editing.
- Verify the old large Home Resume/Clear card never renders.
- Create a recoverable prior workspace, return Home, and verify the compact Taskbar recovery control resumes the intended workspace and its clear action removes the recovery state.
- At narrow widths, verify recovery chrome collapses without colliding with My Work, Search, Project tabs, or the account control.
- Test Taskbar Labels = Auto / Always / Icons. Auto should compact at constrained widths; Icons must retain accessible names/tooltips.
- Test Project Tabs = Compact / Standard with short/long Project names and multiple open Projects.

### Appearance persistence / preference contract

- Save `dense`, `compact`, and `comfortable` density through the server preference route and verify each survives reload.
- Save the new base/pattern/shell/tab parameters and verify the server returns them unchanged for the same user.
- Verify a user with reduced transparency and/or reduced motion receives the constrained effective appearance even when a visual preset requests glass/full motion.

### Hold

Do not call the Appearance/Shell overhaul complete from Pass 9. Sidebar/Taskbar primitive decomposition, shell CSS fossil removal, live Appearance preview refinement, full Library/Projects migration, and application-wide DPI certification remain required.

## 12. WIP57 Pass 10 visual shell + Library Explorer gate

- Verify Sidebar Expanded, Compact, Auto, and mobile drawer behavior after the Shell 2.0 composition migration.
- Verify the Taskbar at narrow/wide desktop widths with zero, one, several, and many open Projects; exercise keyboard Left/Right/Home/End and the Project overflow menu.
- Verify Back/Forward and compact workspace recovery remain usable without the removed Home resume banner.
- In Appearance settings, change theme, base background, Hex/Grid/Dots/None pattern, density, radius, surface, Sidebar surface, Taskbar surface, Taskbar labels, and Project-tab style; confirm the live shell preview reflects the effective settings.
- Enable reduced transparency/reduced motion and confirm accessibility constraints override decorative choices without breaking layout.
- In Library, collapse and reopen the entire Explorer and independently collapse Views, Collections, and Folders. Reload and confirm persisted state.
- Open and close a Library Inspector. The file grid/list must reclaim the full content width immediately with no dead Inspector column.
- Scroll a folder/result set larger than one API page. Additional results must load as the document approaches the bottom; the page must not stop at an internal fixed-height container.
- Test Library Grid and List while Explorer and Inspector are open/closed at 100%, 125%, and 150% DPI.
- Create manual and Smart Collections; rename and remove them; update a Smart Collection from the current filtered view; removing a Collection must not remove its Library items.
- Verify Library Explorer remains usable at desktop/tablet/mobile widths without nested-scroll traps.

## 13. WIP57 Pass 11 Library organization + Media Viewer gate

### File Explorer organization

- Create a folder with at least 30 mixed files and folders. Switch Sort to Custom order and drag several entries before/after one another; reload and confirm the stored order is stable.
- Confirm custom drag ordering is disabled while a text search is active or while results are grouped, so drag/drop cannot imply an ambiguous cross-result ordering.
- Exercise Grid, Compact Grid, List, and Details with Explorer and Inspector open/closed at 100%, 125%, and 150% scaling.
- Exercise Group by Type, Project, and Review. Saved views must restore grouping, layout, sort, query, tags, and search scope.
- Search the current folder, descendants, current Project, and entire Library with nested folders and similarly named files. Confirm result scope is exact and ACL filtering remains intact.
- Filter by tag and media/file category; verify original filename and metadata searches resolve expected files without exposing inaccessible items.

### Media resource path

- Open image, video, audio, PDF, text, and 3D Library items with both generated derivatives present and absent.
- Verify the unified viewer receives only ready derivatives matching the current source checksum and never chooses a stale derivative after replacing a source file.
- For video/audio derivatives, seek forward/backward repeatedly and verify HTTP byte-range behavior rather than full-file re-download on every seek.
- Temporarily remove/corrupt a generated derivative and verify the viewer degrades/falls back safely instead of displaying another asset or stale cached bytes.
- Verify derivative URLs cannot escape the managed derivative root and remain permission-checked through the source Library item.

### Media Viewer shell

- Viewer should open with the media stage dominant and the file rail/details closed.
- Toggle Details and Files independently; closing either must immediately return space to the media stage.
- Move between files with toolbar/keyboard navigation and verify Details does not remain unexpectedly expanded for the next asset.
- Verify toolbar, navigation buttons, status row, media controls, and modal bounds at 100%, 125%, 150%, 1080p, ultrawide, and narrow desktop widths.

### Shell migration

- Exercise Sidebar Expanded/Compact/Auto/mobile drawer after removal of version-stamped active markup dependencies.
- Exercise primary Taskbar actions at narrow and wide widths with Auto/Always/Icons labels; verify labels, badges, and hotkeys obey the canonical Shell 2.0 styling.
- Exercise still-legacy Taskbar account/notification/Ticket popovers before deleting their old CSS in a later pass.

## Pass 12 — Transfer Center + Projects state separation

- [ ] Taskbar Transfer Center opens/closes correctly at 100%, 125%, and 150% Windows scaling.
- [ ] Browser durable uploads appear in Transfer Center and survive Library navigation.
- [ ] Browser upload pause/resume/retry/remove controls act on the existing durable offline queue.
- [ ] Native Desktop uploads and downloads appear in the same Transfer Center without duplicate polling storms.
- [ ] Native pause/resume/retry/cancel controls reflect true TransferManager capability state.
- [ ] Offline/unreachable/maintenance/draining/restarting/read-only/incompatible states show held posture rather than destructive failure.
- [ ] Retry-all retries browser and native failures without duplicating completed work.
- [ ] Project Overview clearly separates Lifecycle, Production Phase, Health, Owner, and Integrations.
- [ ] `healthy`, `attention`, `at_risk`, and `blocked` Project Snapshot states render consistently in Project Overview, Home, Portfolio/My Work surfaces.
- [ ] Integrations metric opens the canonical Project Integrations (`links`) workspace.

## Pass 13 — Library Explorer + Projects readiness

- [ ] Library Explorer folder expansion survives leaving/re-entering Library and app restart/server-state hydration.
- [ ] Expand all handles deep nested folders without horizontal clipping or runaway layout growth.
- [ ] Collapse all leaves the Library root usable and expandable.
- [ ] Tree behavior remains usable with "Show files in tree" enabled for large folders.
- [ ] Project Plan readiness renders correctly for empty, partial, and fully configured Projects.
- [ ] Readiness labels match canonical Project Snapshot/setup checks.
- [ ] Project Integrations wording is consistent across tab, header, save state, and Overview action.
- [ ] Portfolio, Home, My Work, and Project Overview render `at_risk` consistently.

## P16 capability-exposure runtime matrix

### Library lifecycle / traceability

- [ ] Open Lifecycle for an active Library item and verify backlinks list only authorized references.
- [ ] Change retention policy/date with and without required permission/PIN; reload and verify canonical server state.
- [ ] Apply/remove legal or administrative hold and verify destruction stays blocked while held.
- [ ] Archive then restore an item and verify references/version history remain intact.
- [ ] Open destruction preview and confirm dependency/version/backlink evidence matches the actual item.
- [ ] Permanent destruction requires the typed title and cannot bypass server authorization.

### Access Explorer

- [ ] Compare allowed and denied users/actions against `/api/access/explain` and real attempted operations.
- [ ] Verify rule contributors do not leak inaccessible Project/user information.
- [ ] Exercise Project Access from admin and non-admin contexts.

### Workforce availability

- [ ] Create/cancel unavailable, limited, preferred, and time-off windows as self.
- [ ] Direct manager may manage direct reports but not unrelated people.
- [ ] Ordinary viewers never receive private reason text they cannot inspect.
- [ ] Scheduler conflict planning reflects unavailable/limited/time-off windows.
- [ ] Preferred windows appear as positive readiness signals, not blocking conflicts.
- [ ] Exercise DST/timezone boundaries using WorkingPattern timezone authority.

### Project workflow graph

- [ ] Focus Project and control records with incoming/outgoing/both directions.
- [ ] Exercise depth 1–4 and verify authorization filtering at every hop.
- [ ] Confirm graph truncation at the bounded edge limit is explicit rather than silently dropping data.
- [ ] Open linked resources from graph evidence where supported and verify no duplicate graph store exists.

### Media metadata preview

- [ ] Safe Share preview correctly lists retained metadata, removed sensitive categories, and redaction state before export.
- [ ] Strip All preview shows the reduced policy before generation.
- [ ] Custom category preview is denied without manage capability and succeeds with it.
- [ ] Sensitive values remain redacted when the caller lacks sensitive-metadata permission.
- [ ] Cancel preview and confirm no derivative job is created.

### Admin audit activity

- [ ] Data & Audit loads `/api/audit/activity` rather than ordinary `/api/activity` for authoritative evidence.
- [ ] Filter by actor, action, resource type, exact resource ID, Project, and from/to time window.
- [ ] Evidence metadata renders without becoming a second editable source of truth.
- [ ] Ordinary human Activity remains distinct from admin audit evidence.

## P17 — Runtime certification / evidence-driven closeout

P17 is the next engineering checkpoint after P16C. No new speculative architecture is admitted unless runtime evidence proves the current authority is insufficient.

### Fresh server/bootstrap

- [ ] Fresh PostgreSQL bootstrap through all 89 migrations.
- [ ] OOBE/setup → first login → authenticated bootstrap.
- [ ] Failed startup exits the managed Node process after cleanup.
- [ ] Clean Windows shutdown kills the entire managed process tree.
- [ ] Restart/reconnect/recovery/read-only/incompatible posture survives real interruptions.

### Windows visual certification

- [ ] 100% scaling.
- [ ] 125% scaling.
- [ ] 150% scaling.
- [ ] Narrow desktop and responsive edge widths.
- [ ] Sidebar/taskbar/icon geometry, modal bounds, action wrapping, Library, Viewer, Projects, People, Admin.

### Multi-user / authorization

- [ ] At least four role/permission profiles plus admin.
- [ ] Multiple tabs/users editing the same work.
- [ ] Calendar private/participants/Project/Studio visibility matrix.
- [ ] Library folder ACL + lifecycle actions.
- [ ] Access Explorer explanations match actual authorization results.

### Runtime/performance evidence

- [ ] Measure idle request counts rather than eyeballing logs.
- [ ] SSE reconnects back off and reset after healthy connection.
- [ ] Multi-tab sync leadership performs one network cycle per elected leader.
- [ ] Notification reconciliation stays quiet while the stream is healthy.
- [ ] Native transfer reconciliation stays push-first with bounded safety polling.
- [ ] Board/Whiteboard/Calendar fallback cadence matches WIP56 hardening.
- [ ] Background mirror/task logs settle to idle instead of continuous chatter.

### P17 release rule

Every runtime defect gets the smallest authoritative fix plus a regression gate. Do not reopen broad architecture from grep aesthetics. P17 can only become a trusted packaged checkpoint after runtime evidence, source validation, manifest verification, ZIP integrity, SHA-256, and release metadata all agree on the canonical checkpoint identity.


## Pass 14 — Library operations / Viewer / Project closeout (carried into 0.512.2)

- [ ] At 100%, 125%, and 150% Windows scaling, verify Library Explorer, breadcrumbs, bulk actions, viewer fallback/Retry, transfer browser-handoff, and Project closeout controls remain reachable.
- [ ] Exercise folder ACLs, backlink/hold/retention destruction restrictions, and latest Project closeout revision checks.
- [ ] At 100%, 125%, and 150% Windows scaling, verify Pass 15 Server Configuration contextual domains, Tool Infrastructure Advanced time administration, and Operations consolidated hub.
- [ ] Run the authoritative Pass15 merge assertion gate and record code-level baseline preservation evidence.
