import type { PlanningCalendarEvent, PlanningResource, ProductionWindowDraft } from "./SchedulePlanningDialog";

export type TimeUser = {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  capacityHours?: number | null;
  isAdmin?: boolean;
  pinConfigured?: boolean;
};

export type TimeProject = {
  id: string;
  name: string;
  archived?: boolean;
  projectType?: string | null;
};

export type TimeBreak = {
  id: string;
  type: string;
  note?: string | null;
  startedAt: string;
  endedAt?: string | null;
  durationMinutes?: number | null;
  computedDurationMinutes: number;
  running?: boolean;
};

export type TimeEntry = {
  id: string;
  userId: string;
  user?: TimeUser | null;
  projectId?: string | null;
  project?: { id: string; name: string } | null;
  title: string;
  description?: string | null;
  category?: string;
  timezone?: string | null;
  startedAt: string;
  endedAt?: string | null;
  durationMinutes?: number | null;
  grossDurationMinutes?: number;
  breakMinutes?: number;
  computedDurationMinutes: number;
  billable?: boolean;
  source?: string;
  running?: boolean;
  lockedAt?: string | null;
  breaks?: TimeBreak[];
  activeBreak?: TimeBreak | null;
};

export type ScheduleBlock = {
  id: string;
  userId?: string | null;
  user?: TimeUser | null;
  projectId?: string | null;
  project?: { id: string; name: string } | null;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  type: string;
  windowKind?: string;
  status?: string;
  participantIds?: string[];
  resources?: Array<{ id?: string; resourceId: string; quantity: number; resource?: PlanningResource | null }>;
  calendarEventId?: string | null;
  calendarSync?: boolean;
  calendarEvent?: { id: string; title: string; startsAt: string; endsAt?: string | null; status: string } | null;
  revision?: number;
  timezone?: string | null;
  recurrenceGroupId?: string | null;
  recurrenceIndex?: number | null;
  recurrenceFrequency?: "daily" | "weekly" | null;
  color?: string | null;
  durationMinutes?: number;
};

export type TimeException = {
  code: string;
  severity: "low" | "medium" | "high";
  entryId?: string;
  message: string;
};

export type TimeSummary = {
  trackedMinutes: number;
  totalMinutes: number;
  billableMinutes: number;
  breakMinutes: number;
  scheduledMinutes: number;
  capacityMinutes: number;
  remainingCapacityMinutes: number;
  overtimeMinutes: number;
  varianceMinutes: number;
  utilizationPercent: number;
  runningCount: number;
  entryCount: number;
  byUser: Array<{ id: string; name: string; minutes: number }>;
  byProject: Array<{ id: string; name: string; minutes: number }>;
  byDay: Array<{ date: string; minutes: number }>;
};

export type WorkspacePayload = {
  range: { start: string; end: string; weekStart: string };
  currentUser: TimeUser;
  canManage?: boolean;
  permissions?: { canAddManual?: boolean; canEditOwnEntries?: boolean; canDeleteOwnEntries?: boolean; canEditOwnSchedule?: boolean; canDeleteOwnSchedule?: boolean; resourcePlanningEnabled?: boolean; conflictWarnings?: boolean; calendarMirrorDefault?: boolean };
  active: TimeEntry | null;
  entries: TimeEntry[];
  scheduleBlocks: ScheduleBlock[];
  users?: TimeUser[];
  summary: TimeSummary;
  exceptions: TimeException[];
  planning?: {
    conflicts: Array<{ id: string; kind?: "person" | "resource"; userId?: string; resourceId?: string; blockIds: string[]; severity: "medium" | "high"; message: string }>;
    capacity: Array<{ userId: string; name: string; plannedMinutes: number; unavailableMinutes: number; capacityMinutes: number; loadPercent: number }>;
    milestones: Array<{ projectId: string; projectName: string; projectType?: string | null; targetDate: string; priority: string; status: string }>;
    resources: PlanningResource[];
    recommendedResources?: PlanningResource[];
    calendarEvents: PlanningCalendarEvent[];
  };
};

export type ViewMode = "week" | "schedule" | "plan";
export type ScheduleEditor = {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  color: string;
};

export const EMPTY_SUMMARY: TimeSummary = {
  trackedMinutes: 0,
  totalMinutes: 0,
  billableMinutes: 0,
  breakMinutes: 0,
  scheduledMinutes: 0,
  capacityMinutes: 0,
  remainingCapacityMinutes: 0,
  overtimeMinutes: 0,
  varianceMinutes: 0,
  utilizationPercent: 0,
  runningCount: 0,
  entryCount: 0,
  byUser: [],
  byProject: [],
  byDay: [],
};

export function mondayStart(value: Date) {
  const date = new Date(value);
  const day = date.getDay();
  const offset = (day + 6) % 7;
  date.setDate(date.getDate() - offset);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

export function localDateKey(value: string | Date) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toLocalInput(value: string | Date) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function fromLocalInput(value: string) {
  return new Date(value).toISOString();
}

export function durationLabel(minutes: number) {
  const safe = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest}m`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

export function clockLabel(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function dateTimeLabel(value: string) {
  return new Date(value).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function makeScheduleEditor(day = new Date()): ScheduleEditor {
  const start = new Date(day);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return { title: "Time off", description: "", startsAt: toLocalInput(start), endsAt: toLocalInput(end), color: "#4f8df7" };
}

export function makeProductionWindowDraft(day: Date, userId: string, projectId = "", calendarMirror = false): ProductionWindowDraft {
  const start = new Date(day);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    title: "",
    description: "",
    userId,
    projectId,
    startsAt: toLocalInput(start),
    endsAt: toLocalInput(end),
    type: "work",
    windowKind: "standard",
    status: "confirmed",
    participantIds: [],
    resources: [],
    calendarMirror,
    calendarEventId: null,
    color: "#4f8df7",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    recurrenceFrequency: "",
    recurrenceOccurrences: 2,
  };
}
