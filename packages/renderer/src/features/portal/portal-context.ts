import type { ClusterAccountType, ClusterContractorPortalFeature, ClusterPortalAudience } from "@cluster/shared";
import { api } from "../../core/api";

export type PortalContext = {
  studioName: string;
  mainUrl: string;
  hostAudiences: ClusterPortalAudience[];
  portals: Record<ClusterPortalAudience, { enabled: boolean; url: string; ownHost: boolean }>;
  contractorFeatures: ClusterContractorPortalFeature[];
  user: { id: string; name: string; username: string; avatarUrl: string | null; accountType: ClusterAccountType; portal: ClusterPortalAudience | null; readOnly: boolean; accessExpiresAt: string | null } | null;
};

export const loadPortalContext = () => api<PortalContext>("/api/portal/context");

/** Which shell to show: the studio app, the portal here, or the portal at
 *  its own address (a redirect). */
export function portalDecision(context: PortalContext): { kind: "studio" } | { kind: "portal" } | { kind: "redirect"; url: string } {
  if (context.hostAudiences.length) return { kind: "portal" };
  const path = window.location.pathname;
  const audience = context.user?.portal;
  if (audience) {
    const site = context.portals[audience];
    if (site.ownHost && new URL(site.url).host !== window.location.host) return { kind: "redirect", url: site.url };
    return { kind: "portal" };
  }
  if (path === "/portal" || path.startsWith("/portal/")) return { kind: "portal" };
  return { kind: "studio" };
}
