# Cluster live read performance baseline

This tool records **read-only** API response-header latency and HTTP 429 attribution against a **running** Cluster server. It does not modify data, exercise uploads or Git, install dependencies or collect raw responses. It is intended for **before/after comparisons** of Performance Optimization Passes A–G.

## PowerShell (Windows 10/11)

From the checked-out Cluster source directory:

```powershell
$env:CLUSTER_BENCH_URL = 'http://127.0.0.1:YOUR_CLUSTER_PORT'
$env:CLUSTER_BENCH_PATHS = '/health/live,/health/ready'
node tools/scripts/cluster-live-read-baseline.mjs
```

Use the actual configured server port. A baseline **without authentication** can test health probes, but cannot certify Projects, Calendar, notifications or other protected endpoints.

To include read-only authenticated endpoints, set `CLUSTER_BENCH_PATHS` to a comma-separated list of the requested **GET** paths, and supply the current session cookie using `CLUSTER_BENCH_COOKIE` in the **local machine's environment**. Never paste or commit a cookie or benchmark output containing sensitive data. Authenticated testing refuses insecure remote HTTP; localhost HTTP and remote HTTPS are supported.

Optional controls:

| Variable | Default | Safe limits |
| --- | --- | --- |
| `CLUSTER_BENCH_REQUESTS` | 24 | 1–128 |
| `CLUSTER_BENCH_CONCURRENCY` | 2 | 1–4 |
| `CLUSTER_BENCH_DELAY_MS` | 250 | 100–2000 |
| `CLUSTER_BENCH_TIMEOUT_MS` | 10000 | 1000–60000 |
| `CLUSTER_BENCH_PATHS` | `/health/live,/health/ready` | 1–8 GET routes |

A benchmark run returns JSON with per-route request counts, **successful HTTP 2xx-only** response-header p50/p95 latency, unexpected 3xx responses, 429s by server-defined rate-limit bucket, 5xx, authorization denials, and network failures. Failed and redirected responses are excluded from the p50/p95 sample pool; each route exposes `successfulLatencySamples`. Paths are reported **without query strings**, credentials are never printed, response bodies are cancelled immediately, redirects are not followed, and concurrency is bounded. Exits nonzero on **any non-2xx response or network error** (including login redirects and 401/403/404). `passed` is true only if every request returned 2xx. Distinct query strings on the same pathname are rejected, because sanitized labels would otherwise merge incompatible workloads.

**Important:** The numbers are response-header latency, not full-page load, full file transfer time or SQL execution time. For database work, pair with Cluster Operations' existing PostgreSQL / `pg_stat_statements` and per-request SQL fingerprint diagnostics. For UI responsiveness, use the client performance panel. Test both **idle** and during concurrent permitted media/Git/upload workloads.

## Acceptance workflow

1. Record version, commit, Windows hardware, Node/PostgreSQL versions, client count and workload.
2. Run the baseline with a few representative read-only routes against the current release. Do not compare a health probe with a heavier authenticated endpoint.
3. Install a reviewed/certified candidate by the normal Windows release path; preserve data and verify upgrade readiness first.
4. Repeat the **same** routes, client count, warm-up, concurrency and dataset, with five independent runs if practical.
5. Compare request volume, 429s, p95 latency, SQL query count, worker/queue load and peak RAM. Differences without matched conditions are not evidence of a speedup.
6. Investigate regressions before merging additional thread/process changes.

The script is a measurement aid. It does not itself prove that the optimization branch is production-ready.

**Report version:** `cluster-live-read-baseline-v2`. The old v1 p95 included failing HTTP response times; do not compare v1 and v2 directly. Capture both before/after measurements with v2 under matched conditions.

## Comparing before/after reports

Capture v2 JSON output from the **same** authenticated GET routes with matched datasets, client count, concurrency, delay, hardware and background workload. At least ten successful responses per route are required for a comparison. Do not treat a login redirect, 401 or failed response as a valid baseline.

```powershell
$env:CLUSTER_BENCH_REQUESTS = '64'
$env:CLUSTER_BENCH_CONCURRENCY = '2'
node tools/scripts/cluster-live-read-baseline.mjs > before.json
# Upgrade only through the reviewed Windows release path, verify data and services.
node tools/scripts/cluster-live-read-baseline.mjs > after.json
node tools/scripts/cluster-compare-read-baselines.mjs before.json after.json
```

The comparator refuses v1, failed, incomplete, duplicate-route, or mismatched workloads. It flags any route with a p95 increase of at least 15%, exiting 1 for review; invalid data exits 2. It never prints raw report contents or credentials. A single comparison is **not** statistical proof of a speedup, so collect several matched runs and examine PostgreSQL query count, peak RAM, GPU/CPU contention and real user latency separately.
