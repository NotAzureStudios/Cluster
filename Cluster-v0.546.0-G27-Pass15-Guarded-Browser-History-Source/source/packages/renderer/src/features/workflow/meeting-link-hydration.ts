import type { ClusterWorkNavigationTarget } from "./work-navigation-types";

/** A browser URL carries Meeting identity, not Calendar visibility authority. */
export function pendingMeetingBrowserLink(input: {
  screen: string;
  search: string;
  projectId?: string | null;
}): ClusterWorkNavigationTarget | null {
  if (input.screen !== "calendar") return null;
  const inspect = new URLSearchParams(input.search).get("inspect") || "";
  if (!inspect.startsWith("meeting:")) return null;
  const meetingId = inspect.slice("meeting:".length);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(meetingId)) return null;
  return { screen: "calendar", projectId: input.projectId || null, inspectScope: "meeting", inspectId: meetingId };
}
