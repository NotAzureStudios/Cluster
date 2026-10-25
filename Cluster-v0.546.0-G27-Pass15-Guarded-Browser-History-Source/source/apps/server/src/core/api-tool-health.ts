import type { ServerDomainDescriptor } from "../app/server-domain-catalog.js";

/**
 * Read-only API Tool Manager projection over Cluster's existing bounded request
 * telemetry. It does NOT probe endpoints or infer service liveness from traffic.
 * Every observed path is assigned to exactly one most-specific canonical domain.
 */
export type ApiRouteObservation = {
  route: string;
  count: number;
  errors: number;
  p95Ms: number;
  p99Ms: number;
  averageMs: number;
};
export type ApiToolPosture = "no-observations" | "insufficient-data" | "observed-healthy" | "warning" | "degraded";
export type ApiToolHealth = {
  key: string;
  label: string;
  asyncWork: boolean;
  ownerModules: string[];
  routeRoots: string[];
  posture: ApiToolPosture;
  observedRoutes: number;
  requests: number;
  serverErrors: number;
  serverErrorRate: number;
  highestRouteP95Ms: number | null;
  highestRouteP99Ms: number | null;
  routes: Array<ApiRouteObservation & { serverErrorRate: number }>;
};

export const API_TOOL_POSTURE_THRESHOLDS = Object.freeze({
  minimumRequests: 20,
  warningErrorRate: 0.025,
  degradedErrorRate: 0.1,
  warningP95Ms: 750,
  degradedP95Ms: 2000,
  minimumRouteRequestsForLatency: 10,
});

function matchRoot(route: string, root: string): boolean {
  return route === root || route.startsWith(`${root}/`);
}
function boundedNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
function round(value: number): number { return Math.round(value * 10_000) / 10_000; }

export function buildApiToolHealthSnapshot(
  domains: readonly ServerDomainDescriptor[],
  observations: readonly ApiRouteObservation[],
) {
  // Fail closed on unknown API routes: they appear only as an aggregate, never
  // as an unbounded list of user-controlled URLs or path parameters.
  const buckets = new Map(domains.map((domain) => [domain.key, [] as ApiRouteObservation[]]));
  let unclassifiedRequests = 0;
  let unclassifiedRoutes = 0;
  for (const observation of observations.slice(0, 256)) {
    if (!observation || typeof observation.route !== "string") continue;
    const route = observation.route;
    // RuntimeTelemetry normally records Fastify route templates. Refuse routes
    // with query strings, fragments, or obvious unknown/non-API labels here.
    if (!route.startsWith("/api/") || route.includes("?") || route.includes("#")) continue;
    let best: ServerDomainDescriptor | null = null;
    let bestRootLength = -1;
    for (const domain of domains) {
      for (const root of domain.routeRoots) {
        if (matchRoot(route, root) && root.length > bestRootLength) {
          best = domain; bestRootLength = root.length;
        }
      }
    }
    const clean: ApiRouteObservation = {
      route,
      count: boundedNumber(observation.count),
      errors: Math.min(boundedNumber(observation.errors), boundedNumber(observation.count)),
      averageMs: boundedNumber(observation.averageMs),
      p95Ms: boundedNumber(observation.p95Ms),
      p99Ms: boundedNumber(observation.p99Ms),
    };
    if (best) buckets.get(best.key)!.push(clean);
    else { unclassifiedRequests += clean.count; unclassifiedRoutes += 1; }
  }

  const tools: ApiToolHealth[] = domains.map((domain) => {
    const observations = buckets.get(domain.key) || [];
    const requests = observations.reduce((sum, route) => sum + route.count, 0);
    const serverErrors = observations.reduce((sum, route) => sum + route.errors, 0);
    const serverErrorRate = requests ? serverErrors / requests : 0;
    const highestRouteP95Ms = requests ? Math.max(...observations.map((route) => route.p95Ms)) : null;
    const highestRouteP99Ms = requests ? Math.max(...observations.map((route) => route.p99Ms)) : null;
    // Percentiles from a route with only one or two observations are noisy.
    // Display raw evidence, but never elevate the tool based on those values.
    const eligibleLatency = observations.filter((route) => route.count >= API_TOOL_POSTURE_THRESHOLDS.minimumRouteRequestsForLatency);
    const reliableWorstP95 = eligibleLatency.length ? Math.max(...eligibleLatency.map((route) => route.p95Ms)) : 0;
    let posture: ApiToolPosture = "no-observations";
    if (requests > 0 && requests < API_TOOL_POSTURE_THRESHOLDS.minimumRequests) posture = "insufficient-data";
    else if (requests >= API_TOOL_POSTURE_THRESHOLDS.minimumRequests) {
      posture = serverErrorRate >= API_TOOL_POSTURE_THRESHOLDS.degradedErrorRate || reliableWorstP95 >= API_TOOL_POSTURE_THRESHOLDS.degradedP95Ms
        ? "degraded"
        : serverErrorRate >= API_TOOL_POSTURE_THRESHOLDS.warningErrorRate || reliableWorstP95 >= API_TOOL_POSTURE_THRESHOLDS.warningP95Ms
          ? "warning" : "observed-healthy";
    }
    return {
      key: domain.key,
      label: domain.label,
      asyncWork: domain.asyncWork,
      ownerModules: [...domain.ownerModules],
      routeRoots: [...domain.routeRoots],
      posture,
      observedRoutes: observations.length,
      requests,
      serverErrors,
      serverErrorRate: round(serverErrorRate),
      highestRouteP95Ms,
      highestRouteP99Ms,
      routes: observations.sort((a, b) => b.p95Ms - a.p95Ms || b.count - a.count).map((route) => ({
        ...route, serverErrorRate: route.count ? round(route.errors / route.count) : 0,
      })),
    };
  });
  const counts = { "no-observations": 0, "insufficient-data": 0, "observed-healthy": 0, warning: 0, degraded: 0 };
  for (const tool of tools) counts[tool.posture] += 1;
  return {
    schemaVersion: 1,
    sampleScope: "since-server-start",
    percentileScope: "bounded-recent-samples-per-route",
    diagnosticOnly: true,
    livenessChecked: false,
    tools,
    counts,
    unclassified: { routes: unclassifiedRoutes, requests: unclassifiedRequests },
  };
}
