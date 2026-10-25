# G27 Pass 14 | Board read identity, current session and response ordering

## Implemented

- An authoritative per-request generation token prevents a slow Board API reply from overwriting a later Board selection or fresh same-Board refresh.
- Board responses, permission errors and loading state updates are applied only if the request remains the latest AND the active selected Board, authenticated user and screen still match the request's original context.
- Clearing a Board selection invalidates outstanding requests and leaves the empty picker state clean. Session reset increments the generation even before React's subsequent user/Board state render.
- Requests use encoded Board IDs with fresh, nonpersisted server reads, avoiding permission-stale cached Board payloads after access changes. This does not add any recurring poll.
- All existing Board data, error, loading and refresh UI contracts are preserved. No schema or native executable changes.

## Development evidence

`npm run cluster:g27:p14:board-response-race` runs the new 17 executable tests and all inherited Pass 1–13, Forms, resource-link and announcement suites. Tests execute the actual TypeScript `loadBoard` controller and inject out-of-order success, old 403/error, same-ID double refresh, user switch, route departure, empty selection and URL encoding. Scan: 1,147 TS/TSX parsed with zero syntax errors; 3,283 renderer imports resolved; 110 CSS files checked.

## Remaining engineering

A live authenticated browser can still be used to evaluate perceived Board switching latency and request counts, but release certification is outside this workstream. Other workspace-local asynchronous data fetchers should be audited for the same stale-response pattern; do not extrapolate this fix to every tool.
