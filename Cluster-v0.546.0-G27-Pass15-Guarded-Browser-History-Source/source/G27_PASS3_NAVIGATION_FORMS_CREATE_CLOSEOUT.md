# G27 Pass 3: Delegated reviewer activation, Recent admission, and Create & Open

## Source implementation

This checkpoint extends `Cluster v0.546.0 G27 Pass 2` without conflating source-level development checks with runtime certification. The scope is cross-workspace navigation and authorized object opening, not new access grants or a change to the Studio Forms authority.

### 1. Delegated Forms now have a usable reviewer destination

Pass 2's API could resolve the private owning Form for an authorized delegated reviewer, but the renderer still navigated ID-only submissions into **admin-only Studio Settings**. This prevented non-admin reviewers from using Inbox/deep links despite holding a per-Form grant.

- The narrow `studio-form` and `form-submission` navigation inspector scopes now send **non-admin reviewers to Settings → My Forms**. All other Studio Systems scopes remain guarded by administrative access.
- The previous `#studioSettings?inspect=form-submission:...` route is redirected for signed-in non-admin reviewers without granting any Studio Settings mutation permission.
- Existing URL route context preserves the authorized inspector on both personal and Studio Settings screens; `#settings/forms` and `#settings/licenses` no longer normalize to Privacy.
- My Forms separately requests `GET /api/forms/available` and `GET /api/forms/review-assignments`. An unavailable submission-entitlement projection cannot hide otherwise valid reviewer assignments.
- An inspector target is resolved through a **fresh uncached** per-response server authorization check. The owning Form must independently match the user's current active review assignment. Missing, moved, revoked or inaccessible submissions do not open an unrelated Form, and an error never discloses response content.
- Manually choosing another Form clears the stale response inspector and query parameter. The selected submissions panel still enforces its own per-Form grant and exact selected-ID access server-side.

### 2. Recent Project/Board/Whiteboard navigation revalidates actual resources

Local session history and native Desktop recents are **hints, not permission grants**.

- Online openings perform fresh, nonpersistent, no-SWR reads of `/api/projects/:id/snapshot`, `/api/boards/:id`, or `/api/whiteboards/:id` before navigation.
- Responses must identify the exact resource, and Board/Whiteboard records must still have the exact project placement represented by the saved route.
- Authorization failures, vanished/moved objects, transport failures and session/permission/query changes during the request block navigation instead of displaying stale content.
- Browser navigation uses typed history and dispatches the standard route event only *after* admission. This retains back/forward behavior.
- The palette does not render stale history-provided private resource titles. Project and project Board labels are re-derived from currently available project data; Whiteboards and other unaudited histories receive generic labels.
- In explicitly offline mode, a Project/Board recent is only eligible when available in the caller's loaded, permission-filtered local project summary. A project-owned Board cannot satisfy a standalone Board route. Standalone Whiteboards have no matching locally verified summary and are not claimed as offline-authorized.

### 3. Shared Create & Open now carries the created object's identity

- Calendar events open with `calendar-event` inspector plus new event ID.
- Scheduler blocks open with `schedule-block` inspector plus new block ID.
- Timeline items open with `timeline-item` inspector plus new item ID.
- Packets open with `workPacket`/packet ID rather than defaulting to the entire Packets index.
- Legacy project workflow Meetings still open the project Plan. Their IDs are *not* CalendarEvent IDs, so automatically converting them into Calendar links would route to an unrelated object.

### 4. Regression and implementation evidence

Repeatable script: `npm run cluster:g27:p3:navigation-admission` (focused G27 Pass 3, Pass 2 Forms policy and target regressions, Pass 1 Search admission, Studio Form search, announcement navigation, syntax/import/CSS source scan).

Checks include exact delegated scope gating, no administrative privilege escalation, ID-only Form resolver semantics, independent grants, project/Board/Whiteboard identity and placement, stale-session interruption, offline fallback constraints, and concrete Create & Open target IDs.

Development only: this archive does **not** include a full dependency-installed Node 24 build, fresh PostgreSQL 18 migration verification, native Windows/Qt binaries built from this source, or authenticated real-browser/multi-user end-to-end execution. No release certification is claimed.

## Remaining connected work

G27-05/06 source implementation is improved but not closed. Remaining: general cross-resource navigation admission (beyond these Recent and delegated Form routes), additional stale inspector/context handling, remaining shared workflow surfaces (G27-07+), cross-tab permission revocation consistency, and product-led browser tests in a provisioned environment. G28 and TD7 remain separate after G27. Unsafe file deletion and destructive operations are not touched.
