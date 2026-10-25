# G27 Pass 4: Card notification Board placement

## Confirmed navigation defect

The canonical Card resource address carries `kind`, `id`, and optional `projectId`; it intentionally does **not** guarantee an owning Board ID. `notificationWorkNavigation()` was building a Card inspector on the Board screen without a `boardId`, so the application could retain its last selected Board. In practice clicking a Card alert could show the wrong Board, while native Desktop routes could degrade to Inbox despite the notification having an explicit `boardId` already available.

## Source changes

- Notification/Activity/Home/My Work routes now preserve the existing notification's explicit `boardId` for Card inspector targets, including when the resource address itself comes from typed shared canonical identity.
- Validation accepts bounded canonical Board identifiers and refuses malformed, oversized or navigation-like values.
- Historical Cards without an owning Board ID route to the known parent Project (no specific Card selection is falsely claimed) or Inbox if no Project is known. They **do not** replay the previous Board or invent an ownership edge.
- With a Board ID, native Desktop route generation now emits `board/{projectId}/{boardId}/inspect/card/{cardId}` using the already supported grammar.
- Announcement recipient isolation, onboarding targets, Project resources and other canonical navigation remain unchanged.

## Tests

`node tools/scripts/cluster-g27-p4-notification-card-navigation-tests.mjs`: 15 executable assertions covering exact Board/Card target, no-Board Project/Inbox fallback, malformed ID rejection, typed resource vs legacy entity source, native route, and non-Card regression.

`npm run cluster:g27:p4:notification-card-navigation`: those checks plus the inherited Pass 3 Form/Recent/Search/Create/Announcement regression scripts and source scan.

## Next connected work

An **old or moved Card notification** that lacks current Board context still cannot deep-link to the Card itself. Doing so safely needs an on-demand authorized Card-to-current-Board resolver and moved/deleted/revoked handling, rather than guessing Board identity. This is explicitly deferred within G27-05/06, not silently treated as complete. Full typecheck/Node24, live Postgres, Windows/Qt and authenticated multi-user browser certification remain distinct gates.
