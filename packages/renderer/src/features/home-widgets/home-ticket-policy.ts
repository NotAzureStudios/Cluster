/** The Ticket lifecycle is authoritative; user-renamed Board Lists are not. */
export function isOpenHomeTicket(ticket: { ticketStage?: string | null }): boolean {
  return !["resolved", "rejected"].includes(String(ticket.ticketStage || "new").trim().toLowerCase());
}

export function isPriorityHomeTicket(ticket: { ticketStage?: string | null; priority?: string | null }): boolean {
  return isOpenHomeTicket(ticket) && ["urgent", "high"].includes(String(ticket.priority || "").trim().toLowerCase());
}
