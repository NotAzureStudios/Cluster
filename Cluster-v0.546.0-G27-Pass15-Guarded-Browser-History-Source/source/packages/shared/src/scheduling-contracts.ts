export const SCHEDULING_CONTRACT = {
  calendar: {
    defaultEventType: "meeting",
    defaultStatus: "scheduled",
    maximumReminderMinutes: 10_080,
    maximumMeetingAgendaLength: 12_000,
    maximumEventNotesLength: 24_000,
    maximumEventAttachments: 64,
    maximumEventLinkedDecisions: 64,
    maximumEventActionItems: 128,
    eventVisibilities: ["studio", "project", "participants", "private"] as const,
    meetingRsvpStates: ["pending", "accepted", "tentative", "declined"] as const,
    meetingAttendanceStates: ["unknown", "present", "remote", "absent", "excused"] as const,
    maximumUpcomingDays: 30,
    defaultUpcomingDays: 7,
  },
  timeline: {
    defaultType: "manual",
    defaultPastDays: 30,
    defaultFutureDays: 120,
    maximumTimeEntries: 200,
  },
  scheduler: {
    maximumRangeDays: 31,
    maximumBlocksPerRange: 2_000,
    maximumParticipantsPerBlock: 64,
    maximumResourcesPerBlock: 32,
    maximumResourceQuantity: 1_000,
    maximumResources: 2_000,
    maximumRecurringOccurrences: 12,
    defaultResourceQuantity: 1,
    defaultResourceStatus: "active",
    defaultBlockStatus: "confirmed",
    defaultWindowKind: "standard",
    resourceTypes: ["room", "equipment", "stage", "vehicle", "facility", "other"] as const,
    resourceStatuses: ["active", "maintenance", "retired"] as const,
    blockStatuses: ["tentative", "confirmed", "cancelled"] as const,
    windowKinds: ["standard", "shoot", "review", "release", "delivery", "maintenance"] as const,
  },
} as const;

export type CalendarRangeQuery = {
  start?: string;
  end?: string;
  projectId?: string;
};

export type CalendarEventInput = {
  projectId?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt?: string | null;
  allDay?: boolean;
  color?: string | null;
  externalUrl?: string | null;
  eventType?: string;
  status?: string;
  ownerId?: string | null;
  attendeeIds?: string[];
  delegateIds?: string[];
  visibility?: typeof SCHEDULING_CONTRACT.calendar.eventVisibilities[number];
  notes?: string | null;
  timezone?: string | null;
  attachmentIds?: string[];
  decisionIds?: string[];
  actionItemIds?: string[];
  reminderMinutes?: number | null;
  reminderAudience?: "owner" | "participants";
  recurrenceRule?: string | null;
  recurrenceEndDate?: string | null; // Last occurrence civil date in event timezone
  ticketId?: string | null;
  expectedRevision?: number;
  meeting?: {
    agenda?: string | null;
    resources?: ScheduleResourceRequest[];
    allowConflicts?: boolean;
  } | null;
};

export type TimelineRangeQuery = CalendarRangeQuery & {
  type?: string;
};

export type TimelineItemInput = {
  projectId?: string | null;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt?: string | null;
  type?: string;
  color?: string | null;
  externalUrl?: string | null;
};

export type ScheduleResourceType = typeof SCHEDULING_CONTRACT.scheduler.resourceTypes[number];
export type ScheduleResourceStatus = typeof SCHEDULING_CONTRACT.scheduler.resourceStatuses[number];
export type ScheduleBlockStatus = typeof SCHEDULING_CONTRACT.scheduler.blockStatuses[number];
export type ScheduleWindowKind = typeof SCHEDULING_CONTRACT.scheduler.windowKinds[number];

export type ScheduleResourceRequest = {
  resourceId: string;
  quantity?: number;
};

export type ScheduleBlockPlanningInput = {
  participantIds?: string[];
  resources?: ScheduleResourceRequest[];
  windowKind?: ScheduleWindowKind;
  status?: ScheduleBlockStatus;
  calendarMirror?: boolean;
  calendarEventId?: string | null;
  allowConflicts?: boolean;
  expectedRevision?: number;
  timezone?: string | null;
};

export type SchedulePlacementConflict = {
  kind: "person" | "resource";
  severity: "medium" | "high";
  message: string;
  blockId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  userId?: string;
  resourceId?: string;
  requestedQuantity?: number;
  reservedQuantity?: number;
  capacity?: number;
};
