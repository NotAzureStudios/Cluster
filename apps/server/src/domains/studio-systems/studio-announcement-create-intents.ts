import { createHash } from "node:crypto";

/** The intent digest is computed from validated create content, never from an HTTP receipt.
 * It survives a crash after insert and guards against reusing one intent for different content. */
export function announcementCreateDigest(input: { title: string; body: string; audience: unknown; priority: string; requiresAcknowledgement: boolean; discordDeliveryRequested: boolean; scheduledAt?: Date | null }) {
  return createHash("sha256").update(JSON.stringify({
    title: input.title, body: input.body, audience: input.audience, priority: input.priority,
    requiresAcknowledgement: input.requiresAcknowledgement, discordDeliveryRequested: input.discordDeliveryRequested,
    scheduledAt: input.scheduledAt?.toISOString() || null,
  })).digest("hex");
}

export function isAnnouncementCreateUniqueConflict(error: unknown) {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === "P2002";
}
