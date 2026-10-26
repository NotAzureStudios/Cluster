import type { ClusterSearchResultKind } from "@cluster/shared";
import type { ActivityEvent } from "./collaboration-team";
import type { User } from "./identity";
import type { Priority, Project } from "./projects";

export type CalendarEvent = {
  id: string;
  projectId?: string | null;
  project?: Project | null;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt?: string | null;
  allDay?: boolean;
  color?: string | null;
  externalUrl?: string | null;
  eventType?: string | null;
  status?: string | null;
  ownerId?: string | null;
  attendeeIds?: string[];
  reminderMinutes?: number | null;
  recurrenceRule?: string | null;
  ticketId?: string | null;
  revision?: number;
  private?: boolean;
  meeting?: {
    id?: string;
    organizerId?: string;
    agenda?: string | null;
    notes?: string | null;
    timezone?: string | null;
    visibility?: "project" | "participants";
    private?: boolean;
    rsvp?: Record<string, "pending" | "accepted" | "tentative" | "declined" | string>;
    attendance?: Record<string, "unknown" | "present" | "remote" | "absent" | "excused" | string>;
    attachmentIds?: string[];
    decisionIds?: string[];
    actionItemIds?: string[];
    revision?: number;
    schedulerBlockId?: string | null;
    resources?: Array<{ resourceId: string; quantity: number; resource?: { id: string; name: string; type: string; location?: string | null; quantityTotal?: number; status?: string } | null }>;
  } | null;
};

export type TimelineItem = {
  id: string;
  projectId?: string | null;
  project?: Project | null;
  user?: User | null;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt?: string | null;
  type: string;
  color?: string | null;
  externalUrl?: string | null;
  revision?: number;
};

export type TimelineEntry = {
  id: string;
  source: "manual" | "calendar" | "card" | string;
  type: string;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt?: string | null;
  color?: string | null;
  externalUrl?: string | null;
  projectId?: string | null;
  boardId?: string | null;
  listId?: string | null;
  ownerId?: string | null;
  project?: { id: string; name: string } | null;
};

export type TimelinePayload = {
  entries: TimelineEntry[];
  manualItems: TimelineItem[];
  range: { start: string; end: string };
};

export type UpcomingPayload = {
  lookaheadDays: number;
  events: CalendarEvent[];
  dueCards: Array<{
    id: string;
    title: string;
    dueDate: string;
    priority: Priority;
    list: { id: string; title: string };
    board: { id: string; name: string };
    project: { id: string; name: string };
  }>;
};

export type TimeEntry = {
  id: string;
  userId: string;
  user?: User | null;
  projectId?: string | null;
  boardId?: string | null;
  listId?: string | null;
  project?: { id: string; name: string } | null;
  board?: { id: string; name: string } | null;
  cardId?: string | null;
  card?: {
    id: string;
    title: string;
    priority?: Priority;
    dueDate?: string | null;
  } | null;
  title: string;
  description?: string | null;
  startedAt: string;
  endedAt?: string | null;
  durationMinutes?: number | null;
  computedDurationMinutes: number;
  billable?: boolean;
  running?: boolean;
  source?: string;
};

export type TimeSummary = {
  totalMinutes: number;
  runningCount: number;
  entryCount: number;
  byUser: Array<{ id: string; name: string; minutes: number }>;
  byProject: Array<{ id: string; name: string; minutes: number }>;
  byCard: Array<{ id: string; title: string; minutes: number }>;
};

export type TimeApprovalStatus = "draft" | "submitted" | "approved" | "reopened";

export type TimeApproval = {
  userId: string;
  weekStart: string;
  weekEnd: string;
  status: TimeApprovalStatus;
  event?: ActivityEvent | null;
};

export type CommandSearchResultKind = ClusterSearchResultKind;
