import { CLUSTER_ACCOUNT_TYPE_INFO, clusterAccountType, normalizeExternalPortalSettings, portalAudiencesForHost, type ClusterExternalPortalSettings, type ClusterPortalAudience } from "@cluster/shared";

/** The external portal's API boundary. Portal addresses and external
 *  accounts (contractor, client, guest) reach only these endpoints; every
 *  studio API is refused on the server, not just hidden in the UI. */
const ALWAYS: RegExp[] = [
  /^\/api\/portal(\/|$)/,
  /^\/api\/auth\//,
  /^\/api\/me(\/|$)/,
  /^\/api\/setup\/status$/,
  /^\/api\/meta\//,
  /^\/api\/branding\//,
  /^\/api\/public\//,
  /^\/api\/users\/[^/]+\/avatar\/[^/]+$/,
  /^\/api\/notifications(\/|$)/,
];
const CONTRACTOR_FEATURES: Record<string, RegExp[]> = {
  announcements: [/^\/api\/announcements(\/banners)?$/],
  forms: [/^\/api\/forms\//],
  time: [/^\/api\/time\/(active|start|stop)$/],
};
const CLIENT = [/^\/api\/announcements(\/banners)?$/];

export const isExternalAccount = (user: any) => Boolean(CLUSTER_ACCOUNT_TYPE_INFO[clusterAccountType(user?.accountType)].portal);

export function readPortalSettings(settings: Record<string, unknown>): ClusterExternalPortalSettings {
  return normalizeExternalPortalSettings(settings.externalPortal);
}

export function requestHost(request: any) {
  return String(request.hostname || request.headers?.host || "").toLowerCase().replace(/:\d+$/, "");
}

/** Whether an API path is reachable for these portals. */
export function portalApiAllowed(pathname: string, method: string, portal: ClusterExternalPortalSettings, audiences: ClusterPortalAudience[], user?: any) {
  // Guests are view-only: no clocking time or changing work.
  if (user && CLUSTER_ACCOUNT_TYPE_INFO[clusterAccountType(user.accountType)].readOnly && method !== "GET" && /^\/api\/(time|portal\/work)\//.test(pathname)) return false;
  // Contractor features the studio turned off are off on the server too.
  const gated: Array<[RegExp, string]> = [[/^\/api\/portal\/files(\/|$)/, "files"], [/^\/api\/portal\/work(\/|$)/, "work"]];
  for (const [pattern, feature] of gated) if (pattern.test(pathname)) return audiences.includes("contractor") && portal.contractor.features.includes(feature as any);
  if (ALWAYS.some((pattern) => pattern.test(pathname))) return true;
  if (audiences.includes("client") && CLIENT.some((pattern) => pattern.test(pathname))) return true;
  if (!audiences.includes("contractor")) return false;
  const features = portal.contractor.features;
  for (const feature of features) if (CONTRACTOR_FEATURES[feature]?.some((pattern) => pattern.test(pathname))) return true;
  return method === "GET" && /^\/api\/time\/active$/.test(pathname) && features.includes("time");
}

export function audiencesForRequest(request: any, portal: ClusterExternalPortalSettings) {
  return portalAudiencesForHost(portal, requestHost(request));
}
