/**
 * Publication revocation and derivative issuance share the PacketRelease row
 * lock. A receipt is committed only for a still-current, unrevoked release and
 * a currently eligible recipient. It records *issuance*, not confirmed receipt
 * of bytes or a recall guarantee for an already-started transfer.
 */
export async function commitPacketDeliveryIssuance(db: any, input: {
  packetDefinitionId: string;
  releaseId: string;
  expectedManifestSha256: string;
  recipientId: string;
  kind: "artifact" | "bundle";
  position: number | null;
  derivativeHash: string;
  sizeBytes: number;
  verifyRelease: (release: any) => unknown;
  authorizeRecipient: (tx: any, frozenAudience: string, recipient: { id: string }) => Promise<boolean>;
}): Promise<{ conflict?: string; receiptId?: string }> {
  try {
    return await db.$transaction(async (tx: any) => {
    const rows = (await tx.$queryRaw`SELECT "id", "packetDefinitionId", "versionLabel", "manifestJson", "manifestSha256", "revokedAt"
      FROM "PacketRelease" WHERE "id" = ${input.releaseId} AND "packetDefinitionId" = ${input.packetDefinitionId} FOR UPDATE`) as any[];
    const release = rows[0];
    if (!release || release.revokedAt) return { conflict: "PACKET_RELEASE_REVOKED" };
    if (String(release.manifestSha256).toLowerCase() !== input.expectedManifestSha256.toLowerCase())
      return { conflict: "PACKET_RELEASE_CHANGED" };
    try { input.verifyRelease(release); }
    catch { return { conflict: "PACKET_RELEASE_INVALID" }; }
    let manifest: any;
    try { manifest = JSON.parse(String(release.manifestJson)); }
    catch { return { conflict: "PACKET_RELEASE_INVALID" }; }
    if (typeof manifest?.audienceJson !== "string") return { conflict: "PACKET_RELEASE_INVALID" };
    const recipient = await tx.user.findFirst({ where: {
      id: input.recipientId, archived: false,
      accountState: { notIn: ["PRIVACY_ERASED", "DISABLED", "SUSPENDED"] },
      OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: new Date() } }],
    }, select: { id: true } });
    if (!recipient) return { conflict: "PACKET_RECIPIENT_UNAVAILABLE" };
    if (!(await input.authorizeRecipient(tx, manifest.audienceJson, recipient)))
      return { conflict: "PACKET_RECIPIENT_FORBIDDEN" };
    const receipt = await tx.packetDeliveryReceipt.create({ data: {
      releaseId: input.releaseId, recipientId: input.recipientId,
      kind: input.kind, position: input.position, derivativeHash: input.derivativeHash,
      sizeBytes: input.sizeBytes,
    } });
    return { receiptId: receipt.id };
    }, { isolationLevel: "Serializable" });
  } catch (error: any) {
    // A conflicting revocation or concurrent release mutation can raise a
    // PostgreSQL serialization failure rather than return a locked row.
    if (["P2034", "P2002"].includes(String(error?.code || "")))
      return { conflict: "PACKET_ISSUANCE_CONCURRENT" };
    throw error;
  }
}
