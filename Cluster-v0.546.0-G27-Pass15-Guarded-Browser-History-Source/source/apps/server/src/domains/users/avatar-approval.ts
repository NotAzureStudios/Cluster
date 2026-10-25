/** Single authority for the two administrator avatar-review entry points.
 * The audit's pending state is consumed exactly once, and rejection only restores
 * the old image if the reviewed image is still the person's current avatar.
 */
export async function decidePendingAvatarAudit(
  prisma: any,
  audit: { id: string; userId: string; newUrl: string; previousUrl?: string | null },
  actorId: string,
  decision: "approved" | "rejected",
  note: string | null,
) {
  return prisma.$transaction(async (tx: any) => {
    const changed = await tx.avatarAudit.updateMany({
      where: { id: audit.id, status: "pending" },
      data: { status: decision, reviewNote: note, reviewedById: actorId, reviewedAt: new Date() },
    });
    if (changed.count !== 1) return null;
    if (decision === "rejected") {
      await tx.user.updateMany({
        where: { id: audit.userId, avatarUrl: audit.newUrl },
        data: { avatarUrl: audit.previousUrl || null },
      });
    }
    return tx.avatarAudit.findUnique({ where: { id: audit.id }, include: { user: true } });
  });
}
