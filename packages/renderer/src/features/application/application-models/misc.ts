import type { ToolKey } from "../../admin/AdminToolControls";
import type { Priority } from "./projects";

export type SavedCommandSearch = {
  id: string;
  name: string;
  query: string;
  createdAt: string;
  pinned?: boolean;
  lastUsedAt?: string | null;
};

export type RecentNavigation = {
  route: string;
  title: string;
  screen: string;
  projectId?: string | null;
  visitedAt: string;
};

export type ClockIntentPayload = { title: string; projectIds: string[] };

export type ActivityViewMode = "pulse" | "feed" | "presence" | "status" | "users" | "audit";

export type ImportPreviewRecord = {
  id: string;
  type: string;
  title: string;
  detail: string;
  status: "ready" | "imported" | "error";
  error?: string;
};

export type ToolInfrastructureSnapshot = {
  key: ToolKey;
  enabled: boolean;
  status: "operational" | "degraded" | "disabled";
  runtime: { records?: number; active?: number; detail?: string };
};

export type OperationsReportRequest = {
  id: string;
  projectId: string;
  projectName: string;
  requestedAt: string;
  dueDate: string;
  priority: Priority;
  assigneeId?: string | null;
  cardId?: string | null;
  status: "requested" | "unavailable";
  note?: string;
};

export type AdminPageScope = "operations" | "users";

export type AdminSection = "overview" | "jobs" | "operations-center" | "incidents" | "systems" | "security-center" | "approvals" | "reports" | "projects" | "boards" | "whiteboards" | "users" | "permissions" | "activity" | "templates" | "exports" | "imports" | "system" | "data-model" | "persistence" | "maintenance" | "changelog" | "stabilization";
