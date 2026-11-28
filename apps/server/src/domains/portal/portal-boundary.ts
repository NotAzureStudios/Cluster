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
  files: [/^\/api\/library\/[^/]+\/(file|thumbnail|preview|model-thumbnail|viewable-resource|clo)$/],
};
const CLIENT = [/^\/api\/announcements(\/banners)?$/];
const CONTRACTOR_UPLOADS = [/^\/api\/library\/transfers(\/|$)/, /^\/api\/uploads(\/|$)/];

export const isExternalAccount = (user: any) => Boolean(CLUSTER_ACCOUNT_TYPE_INFO[clusterAccountType(user?.accountType)].portal);

export function readPortalSettings(settings: Record<string, unknown>): ClusterExternalPortalSettings {
  return normalizeExternalPortalSettings(settings.externalPortal);
}

export function requestHost(request: any) {
  return String(request.hostname || request.headers?.host || "").toLowerCase().replace(/:\d+$/, "");
}

/** Whether an API path is reachable for these portals. `user` narrows the
 *  contractor portal to its enabled features and to read-only for guests. */
export function portalApiAllowed(pathname: string, method: string, portal: ClusterExternalPortalSettings, audiences: ClusterPortalAudience[], user?: any) {
  if (ALWAYS.some((pattern) => pattern.test(pathname))) return true;
  if (audiences.includes("client") && CLIENT.some((pattern) => pattern.test(pathname))) return true;
  if (!audiences.includes("contractor")) return false;
  const features = portal.contractor.features;
  for (const feature of features) if (CONTRACTOR_FEATURES[feature]?.some((pattern) => pattern.test(pathname))) return true;
  const readOnly = user ? CLUSTER_ACCOUNT_TYPE_INFO[clusterAccountType(user.accountType)].readOnly : false;
  if (features.includes("files") && !readOnly && CONTRACTOR_UPLOADS.some((pattern) => pattern.test(pathname))) return true;
  return method === "GET" && /^\/api\/time\/active$/.test(pathname) && features.includes("time");
}

export function audiencesForRequest(request: any, portal: ClusterExternalPortalSettings) {
  return portalAudiencesForHost(portal, requestHost(request));
}
