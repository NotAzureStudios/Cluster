import type { ClusterDataQuery } from "@cluster/shared";

/**
 * Canonical Data Query transport for GET-backed Data Views. The JSON payload is
 * still normalized against each domain's semantic field catalog before use.
 */
export function parseClusterDataQueryParameter(value: unknown): ClusterDataQuery {
  if (value == null || value === "") return {};
  const raw = String(value);
  if (raw.length > 16_000) throw Object.assign(new Error("Data View query is too large."), { code: "DATA_QUERY_TOO_LARGE", statusCode: 400 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Data View query is invalid JSON."), { code: "DATA_QUERY_INVALID", statusCode: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("Data View query must be an object."), { code: "DATA_QUERY_INVALID", statusCode: 400 });
  }
  return parsed as ClusterDataQuery;
}
