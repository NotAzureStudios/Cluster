export const CLUSTER_EXTERNAL_PORTAL_SECTIONS = [
  "overview",
  "timeline",
  "delivery",
  "library",
  "tickets",
  "reviews",
  "threads",
] as const;

export type ClusterExternalPortalSection = (typeof CLUSTER_EXTERNAL_PORTAL_SECTIONS)[number];

export const CLUSTER_EXTERNAL_PORTAL_DEFAULT_SECTIONS: readonly ClusterExternalPortalSection[] = ["overview", "library"] as const;

export const CLUSTER_EXTERNAL_PORTAL_SECTION_LABELS: Readonly<Record<ClusterExternalPortalSection, string>> = {
  overview: "Overview",
  timeline: "Timeline & milestones",
  delivery: "Builds & releases",
  library: "Library & deliverables",
  tickets: "Tickets",
  reviews: "Reviews",
  threads: "Comments & threads",
};

const CLUSTER_EXTERNAL_PORTAL_SECTION_SET = new Set<string>(CLUSTER_EXTERNAL_PORTAL_SECTIONS);
export function isClusterExternalPortalSection(value: unknown): value is ClusterExternalPortalSection {
  return typeof value === "string" && CLUSTER_EXTERNAL_PORTAL_SECTION_SET.has(value);
}

export function normalizeClusterExternalPortalSections(values: readonly unknown[] | null | undefined): ClusterExternalPortalSection[] {
  if (!Array.isArray(values)) return [];
  const normalized: ClusterExternalPortalSection[] = [];
  for (const rawValue of values) {
    const raw = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
    if (!isClusterExternalPortalSection(raw) || normalized.includes(raw)) continue;
    const value = raw;
    normalized.push(value);
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Account types and the external portal.

export const CLUSTER_ACCOUNT_TYPES = ["employee", "contractor", "client", "guest"] as const;
export type ClusterAccountType = (typeof CLUSTER_ACCOUNT_TYPES)[number];
export type ClusterPortalAudience = "contractor" | "client" | "player";

/** What each account type is for. Employees use Cluster itself; everyone
 *  else signs in to a portal and never reaches studio tools. */
export const CLUSTER_ACCOUNT_TYPE_INFO: Readonly<Record<ClusterAccountType, { label: string; plural: string; description: string; portal: ClusterPortalAudience | null; requiresExpiry: boolean; readOnly: boolean }>> = {
  employee: { label: "Employee", plural: "Employees", description: "Studio member. Uses Cluster.", portal: null, requiresExpiry: false, readOnly: false },
  contractor: { label: "Contractor", plural: "Contractors", description: "Works on the projects they're on through the contractor portal.", portal: "contractor", requiresExpiry: true, readOnly: false },
  client: { label: "Client", plural: "Clients", description: "Works with the studio through the client portal.", portal: "client", requiresExpiry: true, readOnly: false },
  guest: { label: "Guest", plural: "Guests", description: "Short-term, view-only access to the projects they're on, through the contractor portal.", portal: "contractor", requiresExpiry: true, readOnly: true },
};

export function clusterAccountType(value: unknown): ClusterAccountType {
  return (CLUSTER_ACCOUNT_TYPES as readonly string[]).includes(String(value)) ? value as ClusterAccountType : "employee";
}
export function clusterAccountPortal(accountType: unknown): ClusterPortalAudience | null {
  return CLUSTER_ACCOUNT_TYPE_INFO[clusterAccountType(accountType)].portal;
}

export const CLUSTER_CONTRACTOR_PORTAL_FEATURES = ["work", "forms", "files", "time", "calendar", "announcements"] as const;
export type ClusterContractorPortalFeature = (typeof CLUSTER_CONTRACTOR_PORTAL_FEATURES)[number];
export const CLUSTER_CONTRACTOR_PORTAL_FEATURE_INFO: Readonly<Record<ClusterContractorPortalFeature, { label: string; description: string }>> = {
  work: { label: "Work", description: "Cards and tickets assigned to them, and marking them done." },
  forms: { label: "Forms", description: "Forms sent to them." },
  files: { label: "Files", description: "Their projects' files, with uploads." },
  time: { label: "Time", description: "Clock in and out, and this week's hours." },
  calendar: { label: "Calendar", description: "Due dates for their work." },
  announcements: { label: "Announcements", description: "Announcements addressed to them." },
};

export type ClusterPortalSiteSettings = { enabled: boolean; host: string };
export type ClusterExternalPortalSettings = {
  contractor: ClusterPortalSiteSettings & { features: ClusterContractorPortalFeature[] };
  client: ClusterPortalSiteSettings;
  player: ClusterPortalSiteSettings;
};

export const CLUSTER_EXTERNAL_PORTAL_DEFAULTS: ClusterExternalPortalSettings = {
  contractor: { enabled: true, host: "", features: ["work", "forms", "files", "time", "announcements"] },
  client: { enabled: false, host: "" },
  player: { enabled: false, host: "" },
};

/** A host name, lower-cased, without scheme, path or port. Empty when unset. */
export function normalizePortalHost(value: unknown) {
  const raw = String(value || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "");
  return /^[a-z0-9.-]{1,253}$/.test(raw) && raw.includes(".") || raw === "localhost" ? raw : "";
}

export function normalizeExternalPortalSettings(value: unknown): ClusterExternalPortalSettings {
  const input = (typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return {}; } })() : value) as any || {};
  const site = (key: ClusterPortalAudience) => ({
    enabled: typeof input?.[key]?.enabled === "boolean" ? input[key].enabled : CLUSTER_EXTERNAL_PORTAL_DEFAULTS[key].enabled,
    host: normalizePortalHost(input?.[key]?.host),
  });
  const features = Array.isArray(input?.contractor?.features)
    ? CLUSTER_CONTRACTOR_PORTAL_FEATURES.filter((feature) => input.contractor.features.includes(feature))
    : [...CLUSTER_EXTERNAL_PORTAL_DEFAULTS.contractor.features];
  return { contractor: { ...site("contractor"), features }, client: site("client"), player: site("player") };
}

/** Which portals a host serves. Portals without their own host are served on
 *  the main address under /portal; several portals may share one host. */
export function portalAudiencesForHost(settings: ClusterExternalPortalSettings, host: string): ClusterPortalAudience[] {
  const normalized = normalizePortalHost(host);
  if (!normalized) return [];
  return (["contractor", "client", "player"] as const).filter((key) => settings[key].enabled && settings[key].host === normalized);
}
