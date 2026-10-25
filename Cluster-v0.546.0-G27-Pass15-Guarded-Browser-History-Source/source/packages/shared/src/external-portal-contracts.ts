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
