/** Owns async Home reads by account/availability state and request lane.
 * A -> B -> A never revives A's original network response. */
export type HomeRequestTicket = Readonly<{ owner: string; epoch: number; lane: string; sequence: number }>;

export function createHomeRequestAuthority(initialOwner = "") {
  let owner = initialOwner;
  let epoch = 0;
  const lanes = new Map<string, number>();
  return {
    setOwner(nextOwner: string) {
      if (nextOwner !== owner) {
        owner = nextOwner;
        epoch += 1;
        lanes.clear();
      }
    },
    isOwner(expected: string) { return expected === owner; },
    claim(lane: string): HomeRequestTicket {
      const sequence = (lanes.get(lane) || 0) + 1;
      lanes.set(lane, sequence);
      return { owner, epoch, lane, sequence };
    },
    isCurrent(ticket: HomeRequestTicket) {
      return ticket.owner === owner && ticket.epoch === epoch && lanes.get(ticket.lane) === ticket.sequence;
    },
    invalidate(lane: string) { lanes.set(lane, (lanes.get(lane) || 0) + 1); },
  };
}
