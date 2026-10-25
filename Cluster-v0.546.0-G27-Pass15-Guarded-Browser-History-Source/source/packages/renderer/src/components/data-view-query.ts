import type { ClusterDataQuery } from "@cluster/shared";

/** Serialize canonical semantic query intent for GET-backed Data View endpoints. */
export function clusterDataQueryParameter(query: ClusterDataQuery) {
  return encodeURIComponent(JSON.stringify(query));
}
