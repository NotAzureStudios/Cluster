# Phase 5 scalability pass

Cluster v0.408.0 covers roadmap checkpoints **5.8-5.16**. The pass focuses on keeping renderer and transport cost bounded as project, board, timeline, realtime, and asset volume rises.

## Rendering scale

- Ticket and Library workspaces retain explicit virtual-window rendering.
- Board columns retain bounded card batches instead of mounting an unbounded card tree.
- Project portfolio calculations are memoized and search uses deferred input so typing does not synchronously rebuild portfolio facts, filtering, and sorting.
- Project portfolio items and Timeline groups/month columns use `content-visibility: auto` with intrinsic-size hints, allowing Chromium to skip off-screen layout and paint work.

## Request and cache scale

`queryApi` keeps in-flight GET deduplication and now retains query tags in the memory cache. `invalidateApiQueryTags()` can invalidate related memory and durable entries without clearing unrelated workspace data. Delta sync maps entity changes to cache tags while retaining explicit server-provided path invalidation.

## Realtime scale

Collaboration state frames are coalesced through `requestAnimationFrame`. When several stream frames arrive inside one frame interval, only the latest state is committed to React. Delta events are likewise coalesced and de-duplicated by entity before dispatch.

## Asset scale

Dynamic avatars, previews, and workspace images use lazy loading and asynchronous decoding where appropriate. Performance monitoring now records slow image/video/PDF assets separately from JavaScript/CSS navigation resources and marks likely browser-cache hits.

## Regression boundary

`renderer-scalability-phase5-audit.mjs` permanently checks the rendering, request-deduplication, tagged invalidation, realtime batching, and asset-loading contracts introduced or formalized in this pass.
