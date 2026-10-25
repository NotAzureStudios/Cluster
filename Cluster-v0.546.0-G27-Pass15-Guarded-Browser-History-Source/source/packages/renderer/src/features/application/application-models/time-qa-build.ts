import type { DeliveryBuildRecord, DeliveryQaPlanRecord, DeliveryQaSessionRecord, DeliveryReleaseRecord, DeliveryTestCase, DeliveryTestCaseStatus, DeliveryQaPlanStatus, DeliveryQaStatus, DeliveryQaScope, DeliveryQaDecision } from "@cluster/shared";
import type { UserActivitySummary } from "./collaboration-team";
import type { User } from "./identity";
import type { Priority } from "./projects";

export type TimeCorrectionIssueType = "forgot-clock-out" | "wrong-project" | "wrong-duration" | "break-missing" | "duplicate-entry" | "other";

export type TimeCorrectionStatus = "open" | "reviewing" | "approved" | "rejected" | "applied";

export type TimeCorrectionComment = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
};

export type TimeCorrectionHistoryItem = {
  id: string;
  status: TimeCorrectionStatus;
  actor: string;
  note?: string;
  createdAt: string;
};

export type TimeCorrectionRequest = {
  id: string;
  userId: string;
  userName: string;
  projectId?: string;
  issueType?: TimeCorrectionIssueType;
  entryLabel: string;
  requestedDate: string;
  currentValue: string;
  requestedValue: string;
  suggestedValue?: string;
  reason: string;
  status: TimeCorrectionStatus;
  adminNote?: string;
  comments?: TimeCorrectionComment[];
  history?: TimeCorrectionHistoryItem[];
  createdAt: string;
  updatedAt?: string;
};

export type ShiftRuleSettings = {
  enabled: boolean;
  paidBreakMinutes: number;
  unpaidBreakMinutes: number;
  requireBreakAfterHours: number;
  autoBreakReminderMinutes: number;
  maxShiftHours: number;
  overtimeAfterHours: number;
  lateClockOutMinutes: number;
  expectedStart: string;
  expectedEnd: string;
  compareSchedule: boolean;
  updatedAt?: string;
};

export type BreakLedgerEntry = {
  id: string;
  userId?: string | null;
  userName: string;
  projectId?: string | null;
  type: "paid" | "unpaid";
  minutes: number;
  status: "planned" | "taken" | "missed";
  startedAt: string;
  endedAt?: string | null;
  notes?: string | null;
  createdAt: string;
};

export type BuildArtifactRecord = DeliveryBuildRecord;

export type QATestCaseStatus = DeliveryTestCaseStatus;
export type QATestPlanStatus = DeliveryQaPlanStatus;
export type QATestCase = DeliveryTestCase;
export type QATestPlan = DeliveryQaPlanRecord;

export type QASessionStatus = DeliveryQaStatus;
export type QASessionScope = DeliveryQaScope;
export type QASignoffDecision = DeliveryQaDecision;
export type QASessionRecord = DeliveryQaSessionRecord;
export type ReleaseNoteDraft = DeliveryReleaseRecord;

export type ProjectBudgetRecord = {
  projectId: string;
  estimatedHours: string;
  budgetAmount: string;
  hourlyRate: string;
  phase: string;
  note: string;
  updatedAt: string;
};

export type AvailabilityOverrideRecord = {
  userId: string;
  timezone: string;
  workWindow: string;
  days: string;
  pto: string;
  focus: string;
  updatedAt: string;
};

export type LibraryVersionRecord = {
  id: string;
  itemId: string;
  version: string;
  ownerId: string;
  status: "draft" | "in-review" | "approved" | "needs-update" | "deprecated" | "archived";
  notes: string;
  createdAt: string;
};

export type StudioTemplateRecord = {
  id: string;
  type: "card" | "ticket" | "build" | "meeting" | "milestone" | "whiteboard" | "library";
  name: string;
  body: string;
  checklist: string;
  defaultPriority: Priority | "none";
  createdAt: string;
};

export type BackupPolicyRecord = {
  enabled: boolean;
  cadence: "manual" | "daily" | "weekly";
  retentionDays: string;
  includeUploads: boolean;
  includeSecrets: boolean;
  lastCheckpoint: string;
};

export type ProfileCompletionSubject = Partial<UserActivitySummary> & Partial<User>;

export type BuildMilestoneStatus = "scheduled" | "tracked" | "missing";

export type BuildMilestonePlanItem = {
  label: string;
  goal: string;
  status: BuildMilestoneStatus;
  meta: string;
  date?: string | null;
};

export type BuildPlatformField = {
  id: string;
  label: string;
  placeholder: string;
  span?: 1 | 2;
};

export type BuildPlatformGate = { key: string; label: string; detail: string };

export type BuildPlatformLane = { id: string; label: string; hint: string };

export type BuildPlatformProfile = {
  key: string;
  label: string;
  summary: string;
  artifactLabel: string;
  versionLabel: string;
  defaultPlatform: string;
  platforms: string[];
  lanes: BuildPlatformLane[];
  fields: BuildPlatformField[];
  gates: BuildPlatformGate[];
  tips: string[];
};

export type SettingsSection = "profile" | "appearance" | "home" | "navigation" | "privacy" | "pin" | "shortcuts" | "accessibility" | "notifications" | "desktop" | "licenses" | "forms";
