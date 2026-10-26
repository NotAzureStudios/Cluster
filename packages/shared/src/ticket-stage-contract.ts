/**
 * Ticket triage is an explicit lifecycle, independent of Board column placement.
 * A missing historical stage is new/open, never inferred from a List title.
 * Rejected is closed for queue counts but remains distinct from resolved.
 */
export type ClusterTicketStage = "new" | "accepted" | "working" | "waiting" | "review" | "resolved" | "rejected";

export function isClosedTicketStage(stage: unknown): boolean {
  return stage === "resolved" || stage === "rejected";
}

/** Normal Cards still use Board completion; Tickets always use their stage. */
export function isClosedBoardWorkItem(input: {
  workItemKind?: string | null;
  ticketStage?: string | null;
  listIsDone?: boolean | null;
  listTitle?: string | null;
}): boolean {
  if (input.workItemKind === "ticket") return isClosedTicketStage(input.ticketStage);
  return Boolean(input.listIsDone || /done|closed|resolved|fixed|complete|approved|shipped/i.test(input.listTitle || ""));
}
