import { CLUSTER_CREATE_MODE_IDS, CLUSTER_CREATE_MODE_MANIFEST, CLUSTER_PRIMARY_CREATE_MODE_IDS } from "@cluster/shared";
import type { ClusterIconName } from "../../components/ClusterIcon";
import type { QuickCreateMode } from "../application/application-models";

export type CreateModeCatalogItem = {
  id: QuickCreateMode;
  label: string;
  detail: string;
  icon: ClusterIconName;
  keywords: string[];
};

export type CreateModeGroup = {
  label: string;
  detail: string;
  modes: QuickCreateMode[];
};


export const CREATE_MODE_CATALOG: CreateModeCatalogItem[] = CLUSTER_CREATE_MODE_IDS.map((id) => ({
  id,
  label: CLUSTER_CREATE_MODE_MANIFEST[id].label,
  detail: CLUSTER_CREATE_MODE_MANIFEST[id].detail,
  icon: ({ project: "project", card: "work", ticket: "ticket", bug: "warning", build: "tools", timeline: "timeline", calendar: "calendar", scheduler: "clock", meeting: "users", whiteboard: "project", packet: "packet" } satisfies Record<QuickCreateMode, ClusterIconName>)[id],
  keywords: [...CLUSTER_CREATE_MODE_MANIFEST[id].keywords],
}));


export const CREATE_PRIMARY_MODE_IDS: QuickCreateMode[] = [...CLUSTER_PRIMARY_CREATE_MODE_IDS];
export const CREATE_SPECIALIZED_MODE_IDS: QuickCreateMode[] = CLUSTER_CREATE_MODE_IDS.filter((id) => !CLUSTER_CREATE_MODE_MANIFEST[id].primary);

export const CREATE_MODE_GROUPS: CreateModeGroup[] = [
  { label: "Plan", detail: "Start or shape work", modes: CLUSTER_CREATE_MODE_IDS.filter((id) => CLUSTER_CREATE_MODE_MANIFEST[id].group === "Plan") },
  { label: "Coordinate", detail: "Put time and people on the same page", modes: CLUSTER_CREATE_MODE_IDS.filter((id) => CLUSTER_CREATE_MODE_MANIFEST[id].group === "Coordinate") },
  { label: "Deliver", detail: "Track work, issues, and outputs", modes: CLUSTER_CREATE_MODE_IDS.filter((id) => CLUSTER_CREATE_MODE_MANIFEST[id].group === "Deliver") },
];


export function createModeMatches(item: CreateModeCatalogItem, groupLabel: string, query: string) {
  if (!query) return true;
  return [item.label, item.detail, groupLabel, ...item.keywords].join(" ").toLowerCase().includes(query);
}
