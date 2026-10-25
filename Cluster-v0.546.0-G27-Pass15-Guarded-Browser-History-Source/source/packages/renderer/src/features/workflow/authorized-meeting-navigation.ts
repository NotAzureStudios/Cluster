import type { ClusterWorkNavigationTarget } from "./work-navigation-types";

/**
 * Meeting is its own persisted identity beneath a canonical CalendarEvent.
 * The source Meeting ID must be resolved by the server under the same Calendar
 * visibility policy as an exact event read before the renderer may open it.
 */
export type AuthorizedMeetingTarget = {
  meetingId?: string;
  eventId?: string;
  projectId?: string | null;
} | null;

const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id);

export async function resolveAuthorizedMeetingNavigation(
  target: ClusterWorkNavigationTarget,
  input: {
    read: (meetingId: string) => Promise<AuthorizedMeetingTarget>;
    isCurrent: () => boolean;
  },
): Promise<ClusterWorkNavigationTarget | null> {
  if (!input.isCurrent() || target.screen !== "calendar" || target.inspectScope !== "meeting" || !validId(target.inspectId)) return null;
  const meetingId = target.inspectId;
  try {
    const meeting = await input.read(meetingId);
    if (!input.isCurrent() || !meeting || meeting.meetingId !== meetingId || !validId(meeting.eventId)) return null;
    if (meeting.projectId !== null && !validId(meeting.projectId)) return null;
    return {
      ...target,
      screen: "calendar",
      projectId: meeting.projectId,
      inspectScope: "calendar-event",
      inspectId: meeting.eventId,
    };
  } catch {
    return null;
  }
}
