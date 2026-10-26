/** Tracks the owning account and latest request for each private Settings projection.
 * Delayed responses from another account or a superseded refresh must never
 * populate an authenticated surface after an account switch.
 */
export type AccountRequestTicket = Readonly<{ ownerId: string; channel: string; sequence: number }>;

export class AccountRequestAuthority {
  private ownerId: string;
  private sequences = new Map<string, number>();

  constructor(ownerId: string) { this.ownerId = ownerId; }

  switchOwner(ownerId: string): boolean {
    if (ownerId === this.ownerId) return false;
    this.ownerId = ownerId;
    this.invalidateAll();
    return true;
  }

  begin(channel: string): AccountRequestTicket {
    const sequence = (this.sequences.get(channel) || 0) + 1;
    this.sequences.set(channel, sequence);
    return { ownerId: this.ownerId, channel, sequence };
  }

  isCurrent(ticket: AccountRequestTicket): boolean {
    return ticket.ownerId === this.ownerId && this.sequences.get(ticket.channel) === ticket.sequence;
  }

  invalidate(channel: string): void {
    this.sequences.set(channel, (this.sequences.get(channel) || 0) + 1);
  }

  invalidateAll(): void {
    for (const channel of this.sequences.keys()) this.invalidate(channel);
  }
}
