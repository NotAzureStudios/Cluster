# Cluster Phase 8 — Search & Command System

Phase 8 turns Search / Commands into a predictable operating layer for Cluster. Ranking may learn from recency, frequency, and current context, but those signals may only reorder legitimate matches. Personal usage history remains local and bounded; it is not sent to the server as behavioral telemetry.

## Product contract

### 1. Matching and ranking are separate decisions

A result must first match the query through indexed server search, the local search worker, an explicit scope command, or the local navigation/action matcher. Recency, usage, current screen, and current project are ranking signals only. They must never make an unrelated item survive a query.

Remote search results remain authoritative matches because the server index can match content that is intentionally not repeated in the compact palette row.

### 2. Typo tolerance covers common human mistakes without defaulting to full scans

Renderer and server scoring support adjacent transpositions in addition to bounded edit distance. Initials/acronym matching allows short queries such as `pm` to match titles such as `Project Management`. Ordered multi-token matches receive a small proximity boost.

For words of four or more characters, the local and server indexes retain bounded bigram postings. When an exact/prefix posting is unavailable, those postings recover a smaller fuzzy candidate set before falling back to a full index scan. Short queries deliberately retain the broad fallback so acronym matches are not accidentally pruned.

### 3. Usage personalization is local, bounded, and contextual

Search usage records may keep:

- total execution count
- last-used timestamp
- bounded per-screen counts
- bounded per-project counts

The record set remains capped, context maps retain only the most-used entries, and the data stays in the existing preference-storage boundary. Context boosts change ordering only after match eligibility is established.

### 4. Search preference settings actually affect search

`userCommandSearchScope` now affects both command-palette and taskbar search behavior:

- `all` — searchable work plus navigation/actions
- `workspace` — workspace content is the default search surface; an explicit scope prefix can override it in Search / Commands
- `current` — current screen/project context receives a stronger ranking preference without hard-locking results

`userSearchContextAware=false` disables current-screen/project ranking boosts while leaving explicit current-project commands available.

### 5. Results are grouped without breaking keyboard navigation

The palette uses stable groups:

- Current context
- Matches
- Recent
- Navigation
- Actions
- Desktop

Grouping changes presentation and deterministic ordering, not the option index contract. Arrow keys continue to move through actual options; `Home`, `End`, `PageUp`, and `PageDown` provide faster keyboard traversal. Group labels are presentation-only and never become phantom selectable rows.

### 6. Current-project commands are deliberate context actions

When a project is active, Search / Commands exposes direct commands for project Overview, Builds, QA, Control, and Library. A same-project command updates the open project immediately through the bounded project-tab command event; cross-project navigation retains the existing session handoff.

This avoids the old edge case where setting a handoff token and reopening the already-active project did not necessarily change tabs.

### 7. Server authorization remains authoritative

Phase 8 does not broaden the search API or bypass project visibility checks. Remote indexed results still pass the existing `canViewProject` and operator-filter boundary before serialization. No client ranking signal grants access to a server result.

## Privacy and trust boundary

Phase 8 does **not** add:

- behavioral analytics uploads for ranking history
- cross-user search-history sharing
- server-side storage of local execution frequency
- semantic/LLM query logging
- unrestricted command execution
- authorization decisions based on client ranking

The server API contract remains `2026-08-02.62`.

## Release-blocking boundary

`tools/scripts/search-command-phase8-audit.mjs` blocks release packaging if matching/ranking separation, typo/acronym behavior, fuzzy candidate recovery, contextual local usage, settings integration, result grouping, keyboard traversal, current-project commands, authorization boundaries, or packaging documentation regress.

Capability: `search-command-phase8-v1`
