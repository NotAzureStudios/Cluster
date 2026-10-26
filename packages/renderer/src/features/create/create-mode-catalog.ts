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

export type CreateModeGuidance = {
  heading: string;
  description: string;
  required: string;
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

export const CREATE_MODE_GUIDANCE: Record<QuickCreateMode, CreateModeGuidance> = {
  project: { heading: "Project workspace", description: "Choose the production preset, ownership, lifecycle, and starter tools for a new project.", required: "Name, project type, status, and project lead" },
  card: { heading: "Board card", description: "Create actionable board work with a destination, owner, priority, due date, and labels.", required: "Title, board, and list" },
  ticket: { heading: "Ticket", description: "Capture a request, incident, support issue, or cross-team work item in the ticket system.", required: "Title, type, and priority" },
  bug: { heading: "Bug report", description: "Record environment, reproduction steps, expected behavior, actual behavior, severity, and ownership.", required: "Title and reproduction context" },
  build: { heading: "Build artifact", description: "Describe the platform-specific artifact, source revision, QA state, approval, and publishing metadata.", required: "Project, version, lane, and platform" },
  timeline: { heading: "Timeline point", description: "Add a milestone, release, deadline, playtest, meeting, or note with its date range and color.", required: "Title, type, and start date" },
  calendar: { heading: "Calendar event", description: "Schedule meetings, reviews, deadlines, releases, or focus events with location, reminder, ownership, and status.", required: "Title, start, and event type" },
  scheduler: { heading: "Schedule block", description: "Reserve work, focus, meeting, availability, time off, or unavailable time in the workforce schedule.", required: "Title, start, end, and block type" },
  meeting: { heading: "Meeting", description: "Plan a focused team session with a project, time window, agenda, and capacity.", required: "Name, dates, and agenda" },
  whiteboard: { heading: "Whiteboard", description: "Create a canvas with the right project, template intent, and dimensions.", required: "Name and canvas size" },
  packet: { heading: "Packet", description: "Create a studio knowledge, training, policy, procedure, or handoff packet.", required: "Name, purpose, and audience" },
};

export function createModeMatches(item: CreateModeCatalogItem, groupLabel: string, query: string) {
  if (!query) return true;
  return [item.label, item.detail, groupLabel, ...item.keywords].join(" ").toLowerCase().includes(query);
}
