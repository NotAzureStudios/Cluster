import type { ClusterProjectSnapshot } from "@cluster/shared";
import type { TimelineEntry } from "./calendar-time";
import type { LibraryItem } from "./git-library";
import type { User } from "./identity";
import type { ProjectKind, ProjectStatus } from "./project-settings";
import type { WhiteboardElement, WhiteboardProductionRecord } from "./whiteboards";


export type IntegrationConnectionSummary = {
  id: string;
  providerId: string;
  category: string;
  displayName: string;
  status: string;
  healthState?: string | null;
};

export type SourceRepositorySummary = {
  id: string;
  name: string;
  hostingMode: string;
  remoteUrl?: string | null;
  cloneUrl?: string | null;
  defaultBranch: string;
  headRevision?: string | null;
  syncState?: string | null;
  lastSyncedAt?: string | null;
  lastFetchAt?: string | null;
  lastPushAt?: string | null;
  healthState?: string | null;
  healthMessage?: string | null;
  metadata?: Record<string, unknown>;
  connection?: IntegrationConnectionSummary | null;
};

export type ProjectSourceBinding = {
  id: string;
  repositoryId: string;
  role: string;
  branchRole: string;
  defaultBranch?: string | null;
  isPrimary: boolean;
  policyOverrides?: Record<string, unknown>;
  repository?: SourceRepositorySummary | null;
};

export type ProjectIntegrationBinding = {
  id: string;
  connectionId: string;
  resourceType: string;
  externalId?: string | null;
  externalUrl?: string | null;
  displayName?: string | null;
  isPrimary: boolean;
  metadata?: Record<string, unknown>;
  connection?: IntegrationConnectionSummary | null;
};

export type ProjectVersionSummary = {
  id: string;
  label: string;
  stage?: string | null;
  status: string;
  sourceRevision?: string | null;
  buildId?: string | null;
  releasedAt?: string | null;
  createdAt: string;
  components?: Record<string, unknown>;
};

export type Project = {
  id: string;
  name: string;
  externalName?: string | null;
  codename?: string | null;
  aliases?: string[];
  description?: string | null;
  objective?: string | null;
  clientName?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
  tags?: string[];
  color?: string | null;
  healthNote?: string | null;
  source?: string;
  sourceBindings?: ProjectSourceBinding[];
  integrationBindings?: ProjectIntegrationBinding[];
  versions?: ProjectVersionSummary[];
  projectType?: ProjectKind | string | null;
  productionProfile?: string | null;
  blueprintKey?: string | null;
  workspacePresetKey?: string | null;
  provisioningKey?: string | null;
  memberships?: Array<{ userId: string; roleKey?: string | null; roleLabel?: string | null; allocationPercent?: number; accessLevel?: string; isLead?: boolean; status?: string; startsAt?: string | null; endsAt?: string | null }>;
  status?: ProjectStatus | string | null;
  productionTracks?: string[];
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
  revision?: number;
  boards: BoardSummary[];
  whiteboards?: WhiteboardSummary[];
  libraryItems?: LibraryItem[];
  libraryFolderId?: string | null;
  ownerId?: string | null;
  priority?: Priority | string | null;
  external?: boolean;
  capabilities?: {
    level: "none" | "view" | "contribute" | "manage";
    reason: string;
    resolvedAt?: string;
  };
};

export type ProjectSnapshot = ClusterProjectSnapshot;

export type ProjectDashboardActivity = {
  id: string;
  type: string;
  entityType: string;
  title: string;
  message?: string | null;
  createdAt: string;
  user?: Pick<User, "id" | "username" | "displayName" | "avatarUrl"> | null;
};

export type ProjectDashboardPayload = {
  projectId: string;
  generatedAt: string;
  progress: number;
  cards: {
    total: number;
    open: number;
    completed: number;
    overdue: number;
    urgent: number;
    blocked: number;
  };
  assets: {
    boards: number;
    whiteboards: number;
    files: number;
    videos: number;
  };
  timeline: {
    upcoming: TimelineEntry[];
    overdue: number;
  };
  time: {
    loggedMinutes: number;
  };
  workflow: {
    builds: { total: number; failed: number; releaseReady: number };
    delivery?: { ready: boolean; recommendedAction: string; blocked: number; activeHold: boolean; channel: string; published: boolean; releaseId?: string | null; latestBuildId?: string | null } | null;
    qa: { plans: number; sessions: number; attention: number };
    relationships: { total: number; blockers: number; critical: number };
    team: { assigned: number };
  };
  activity: ProjectDashboardActivity[];
};

export type BoardListSummary = {
  id: string;
  title: string;
  isDone?: boolean;
  collapsed?: boolean;
  archived?: boolean;
  assignedUserIds?: string[];
};

export type BoardLabelDefinition = {
  id: string;
  name: string;
  color: string;
};

export type BoardSummary = {
  id: string;
  name: string;
  description?: string | null;
  assignedUserIds?: string[];
  backgroundColor?: string | null;
  backgroundStyle?: "soft" | "solid" | "gradient";
  labelDefinitions?: BoardLabelDefinition[];
  lists?: BoardListSummary[];
  createdAt?: string;
  updatedAt?: string;
  revision?: number;
};

export type WhiteboardSummary = {
  id: string;
  name: string;
  description?: string | null;
  projectId?: string | null;
  canvasWidth?: number;
  canvasHeight?: number;
  updatedAt?: string;
  revision?: number;
  operationSequence?: number;
};

export type ChecklistItem = {
  id: string;
  text: string;
  completed: boolean;
  position: number;
};

export type CardComment = {
  id: string;
  body: string;
  createdAt: string;
  user?: User | null;
};

export type CardActivity = {
  id: string;
  type: string;
  message: string;
  createdAt: string;
};

export type Priority = "low" | "medium" | "high" | "urgent";

export type ExternalEntityLinkSummary = {
  id: string;
  connectionId?: string | null;
  providerEntityType: string;
  providerEntityId: string;
  providerUrl?: string | null;
  metadata?: Record<string, unknown>;
};

export type Card = {
  id: string;
  listId: string;
  assigneeId?: string | null;
  assignee?: User | null;
  title: string;
  description?: string | null;
  workItemKind?: "card" | "ticket" | string;
  ticketStage?: "new" | "accepted" | "working" | "waiting" | "review" | "resolved" | "rejected" | null;
  priority: Priority;
  position?: number;
  dueDate?: string | null;
  startDate?: string | null;
  deferredUntil?: string | null;
  stateEnteredAt?: string | null;
  completedAt?: string | null;
  completionCriteria?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  labels: string[];
  category?: string | null;
  coverColor?: string | null;
  coverImage?: string | null;
  estimatePoints?: number | null;
  memberIds?: string[];
  watcherIds?: string[];
  externalUrl?: string | null;
  externalLinks?: ExternalEntityLinkSummary[];
  checklistItems: ChecklistItem[];
  comments: CardComment[];
  activity?: CardActivity[];
  revision?: number;
};

export type BoardList = {
  id: string;
  title: string;
  assignedUserIds?: string[];
  description?: string | null;
  color?: string | null;
  wipLimit?: number | null;
  isDone?: boolean;
  collapsed?: boolean;
  archived?: boolean;
  position: number;
  cards: Card[];
  revision?: number;
};

export type Board = {
  id: string;
  name: string;
  description?: string | null;
  assignedUserIds?: string[];
  backgroundColor?: string | null;
  backgroundStyle?: "soft" | "solid" | "gradient";
  labelDefinitions?: BoardLabelDefinition[];
  project: Project;
  lists: BoardList[];
  revision?: number;
};

export type WhiteboardCategory = {
  id: string;
  name: string;
  color: string;
  hidden?: boolean;
};

export type WhiteboardLabel = {
  id: string;
  name: string;
  color: string;
};

export type Whiteboard = {
  id: string;
  name: string;
  description?: string | null;
  projectId?: string | null;
  project?: Project | null;
  elements: WhiteboardElement[];
  categories?: WhiteboardCategory[];
  labels?: WhiteboardLabel[];
  productionLinks?: Record<string, WhiteboardProductionRecord>;
  backgroundColor?: string;
  gridColor?: string;
  gridStyle?: "lines" | "dots" | "none";
  canvasWidth: number;
  canvasHeight: number;
  createdAt?: string;
  updatedAt?: string;
  revision?: number;
  operationSequence?: number;
};
