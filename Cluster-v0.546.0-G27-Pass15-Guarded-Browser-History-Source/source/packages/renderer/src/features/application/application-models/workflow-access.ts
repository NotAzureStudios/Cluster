import type { ProjectPermissionLevel } from "../../../core/permissions";
import type { ClusterAccessTargetKind, SharedWorkSavedView } from "@cluster/shared";
import type { EntityKind, EntityReference } from "./identity";

export type HomeRoleKey = "admin" | "lead" | "qa" | "external" | "developer";

export type SavedViewRecord = SharedWorkSavedView;

export type LocalComment = {
  id: string;
  scope: string;
  body: string;
  author: string;
  createdAt: string;
  editedAt?: string;
  pinned?: boolean;
};

export type DependencyStatus = "open" | "watching" | "blocked" | "resolved";

export type WorkLinkRecord = {
  id: string;
  projectId?: string | null;
  source?: EntityReference;
  target?: EntityReference;
  relationship: string;
  status?: DependencyStatus;
  dueDate?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  notes?: string | null;
  critical?: boolean;
  createdAt: string;
  updatedAt?: string;
};

export type RecurringWorkCadence = "daily" | "weekly" | "biweekly" | "monthly";

export type RecurringWorkRecord = {
  id: string;
  projectId?: string | null;
  title: string;
  targetKind: EntityKind;
  cadence: RecurringWorkCadence;
  nextRun: string;
  ownerId?: string | null;
  ownerName?: string | null;
  checklist?: string | null;
  status: "active" | "paused";
  createdAt: string;
  updatedAt?: string;
  lastGeneratedAt?: string | null;
};

export type WatcherRecord = {
  id: string;
  entity: EntityReference;
  userId?: string | null;
  userName: string;
  eventScope: "all" | "status" | "comments" | "files" | "approvals";
  muted?: boolean;
  createdAt: string;
  updatedAt?: string;
};

export type ProjectCloseoutStatus = "draft" | "submitted" | "verified" | "rejected" | "archived";

export type ProjectCloseoutChecklistKey = "cardsClosed" | "ticketsResolved" | "finalBuildLinked" | "libraryApproved" | "timelineComplete" | "hoursReviewed" | "externalDeliverablesConfirmed" | "backupExportCreated" | "archiveApproved";

export type ProjectCloseoutRecord = {
  id: string;
  projectId: string;
  status: ProjectCloseoutStatus;
  checklist: Partial<Record<ProjectCloseoutChecklistKey, boolean>>;
  notes?: string | null;
  approverName?: string | null;
  requestedBy?: string | null;
  submittedBy?: string | null;
  submissionNote?: string | null;
  verifierName?: string | null;
  verificationNote?: string | null;
  rejectionNote?: string | null;
  createdAt: string;
  updatedAt?: string;
  submittedAt?: string | null;
  approvedAt?: string | null;
  verifiedAt?: string | null;
  rejectedAt?: string | null;
  archivedAt?: string | null;
};

export type ExternalPortalAccessLevel = "viewer" | "commenter" | "reviewer";

export type ExternalPortalRule = {
  id: string;
  projectId: string;
  collaboratorName: string;
  accessLevel: ExternalPortalAccessLevel;
  allowedSections: string[];
  canSeeTime?: boolean;
  canSeeBudget?: boolean;
  approvalState: "draft" | "internal-review" | "approved" | "changes";
  status: "draft" | "invited" | "active" | "revoked";
  notes?: string | null;
  critical?: boolean;
  createdAt: string;
  updatedAt?: string;
};

export type AccessSubjectKind = "member" | "team" | "external" | "all";

export type AccessTargetKind = ClusterAccessTargetKind;

export type AccessEffect = "allow" | "deny";

export type AccessRuleStatus = "active" | "paused" | "expired" | "archived";

export type AccessRule = {
  id: string;
  targetKind: AccessTargetKind;
  targetId: string;
  projectId?: string | null;
  subjectKind: AccessSubjectKind;
  subjectId?: string | null;
  subjectName: string;
  effect: AccessEffect;
  level: ProjectPermissionLevel;
  sections?: string[];
  status: AccessRuleStatus;
  expiresAt?: string | null;
  notes?: string | null;
  critical?: boolean;
  createdAt: string;
  updatedAt?: string;
};

export type ProjectShareLink = {
  id: string;
  projectId: string;
  tokenPreview: string;
  accessLevel: ExternalPortalAccessLevel;
  allowedSections: string[];
  expiresAt?: string | null;
  maxUses?: number | null;
  useCount: number;
  status: "active" | "expired" | "revoked";
  createdById?: string | null;
  createdAt: string;
  updatedAt?: string;
  token?: string;
  shareUrl?: string;
};

export type ProjectRoleRecord = { userId: string; role: string; note?: string };

export type ProjectRoleMap = Record<string, ProjectRoleRecord[]>;

export type MeetingRecord = {
  id: string;
  projectId: string;
  name: string;
  goal: string;
  start: string;
  end: string;
  capacity: string;
  status: "planned" | "active" | "review" | "closed";
  createdAt: string;
};

export type AttentionSeverity = "critical" | "high" | "medium" | "low";

export type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  source: "timeline" | "project" | "build" | "time" | "library" | "external" | "team" | "approval" | "ticket" | "activity" | "dependency" | "recurring" | "watcher" | "closeout" | "portal" | "attachment" | "maintenance" | "diagnostics";
  severity: AttentionSeverity;
  projectId?: string | null;
  projectName?: string | null;
  createdAt: string;
  actionLabel: string;
  target: "projects" | "timeline" | "builds" | "scheduler" | "library" | "people" | "inbox" | "activity" | "tickets" | "admin";
};

export type CommandBrief = {
  generatedAt: string;
  clockedIn: number;
  overdue: number;
  changedSinceYesterday: number;
  reportsNeedingTriage: number;
  blockedBuilds: number;
  approvalsWaiting: number;
  todayMilestones: number;
  externalUpdates: number;
  topItems: AttentionItem[];
};
