# API abuse and resource-exhaustion boundary

Cluster v0.356 treats request volume and request *cost* as different security concerns. Authentication throttles remain strict, while the general API now applies a weighted budget plus concurrency backpressure for expensive operations.

## Weighted request budgets

Normal reads cost one budget unit. Ordinary mutations cost two. Batch/import/search/export/model-preview style work costs more, and backup/restore/storage-verification operations are the highest-cost class. The existing authenticated-session/IP rate-limit key remains authoritative, but expensive work consumes multiple units instead of pretending every request has equal server cost.

## Bounded concurrent work

Heavy operations are capped globally and per client. Critical backup/restore/storage-verification operations have a smaller independent ceiling. Cluster rejects excess work with a retryable `503`, `Retry-After`, and `X-Cluster-Backpressure` rather than allowing an unbounded queue to build behind PostgreSQL, filesystem, conversion, or export work.

The limiter is deliberately in-process. It protects one Cluster API process. A future multi-node deployment must use a shared distributed budget if requests for the same studio are spread across multiple API processes.

## Route-specific request body limits

The Fastify global body limit remains large enough for supported legacy/base64 upload flows, but it is no longer the effective limit for every route. Cluster assigns a smaller body ceiling by request purpose before parsing:

- normal API JSON mutations: 2 MiB;
- sync/bulk/import flows: bounded larger envelopes;
- avatar/branding and file uploads: limits derived from the configured raw upload ceiling plus base64 overhead;
- native resumable chunks: bounded near the 8 MiB chunk protocol limit;
- read-only requests: effectively no meaningful request body.

Cluster checks declared `Content-Length` immediately and also wraps the incoming payload stream so chunked requests cannot bypass the route-specific ceiling.

## Backpressure behavior

Backpressure is not an authorization decision and must run in addition to authentication, CSRF/origin checks, and server-side authorization. Expensive-work slots are acquired only after those security checks succeed and are released on normal response or request abort.

Clients should respect `Retry-After` and retry with jitter. The server does not queue an unbounded number of expensive operations on behalf of clients.

## Regression rule

A release must fail its security/source contract if it removes weighted request costs, route-specific stream body limits, heavy/critical concurrency ceilings, abort-safe slot release, or explicit backpressure responses without a reviewed replacement control.
