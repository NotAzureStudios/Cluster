/**
 * Authority for Cluster's intentional short-password exception.
 *
 * Never trust a role supplied by the browser or the administrator performing
 * a credential reset. The target account must hold an actual workspace owner
 * or administrator membership at the moment a new password is saved.
 */
export async function mayUsePrivilegedShortPassword(prisma: {
  workspaceMember: {
    findFirst: (input: { where: { userId: string; role: { in: string[] } }; select: { id: true } }) => Promise<{ id: string } | null>;
  };
}, userId: string): Promise<boolean> {
  if (!userId) return false;
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId, role: { in: ["owner", "admin"] } },
    select: { id: true },
  });
  return Boolean(membership);
}
