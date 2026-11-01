# Memory and file-lifecycle audit (source inspection)

Scope: current GitHub **RC50** baseline on `development`, checked against matching code blocks in the available **RC73** source bundle. This is not a live Windows/Qt/Chromium memory profile and does not certify the whole application.

## Fixed in this pass

1. **PDF print iframe lifetime** (`packages/renderer/src/features/viewer`): the prior print flow created a Blob URL and iframe but only removed them after the iframe's `load` handler. A missing event or navigation could retain both. A scoped print helper now revokes the URL and detaches the frame on normal completion, error, viewer disposal and a 30-second backstop.
2. **Library 3D thumbnail request lifetime** (`LibraryMediaPreview.tsx`): a pending thumbnail fetch previously continued after the React component unmounted, even though a `cancelled` flag suppressed updates. The fetch now uses an AbortController canceled by effect cleanup, limiting unnecessary network and Blob work when browsing between files.

Automated print lifecycle checks cover normal printing, missing load, load error, viewer disposal, immediate disposal and idempotent cleanup. These are **resource ownership tests**, not measurements of heap growth.

## Reviewed and already bounded in RC73

- **Query cache:** 512-entry normal bound with settled in-flight eviction (`packages/renderer/src/core/api/cache.ts`). Long-stuck requests and memory footprint per cache entry still require soak tests.
- **Server media hash cache:** bounded to 1,024 entries (`apps/server/src/core/media-artifact-cache.ts`).
- **Database diagnostic request contexts:** 4,096-request bound and 30-minute TTL (`apps/server/src/core/database-diagnostics.ts`).
- **Resource-change SSE:** clears heartbeat/access timers and unsubscribes on response finish/close (`apps/server/src/domains/changes/resource-change-routes.ts`).
- **3D viewer:** cancels frames, disconnects observers, frees Three.js geometry/materials/renderer and revokes companion URLs (`UnifiedThreeViewer.tsx`).

These checks reduce concern but do **not** prove the absence of leaks, including browser GPU allocations, native Qt objects, server worker processes, streamed transfers or abandoned promises.

## Next runtime leak investigation

Record heap RSS/JS heap, WebGL context count, Node active handles, SSE connections and client request traffic over a repeated workload: login/logout, open/close PDF, model and video, page between Library/Projects, upload/cancel/retry a large file, reopen the same server profile and let the system idle. Take samples after warm-up and after GC where supported; distinguish one-time cache warm-up from sustained retained growth. Repeat on Windows with current build, PostgreSQL and actual media assets. Prefer resource-count assertions and multiple test cycles over single RSS snapshots.

Do not attempt to fix alleged leaks by disabling caches or dropping safety/permission checks.
