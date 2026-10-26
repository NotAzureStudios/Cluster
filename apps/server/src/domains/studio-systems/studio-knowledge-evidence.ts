export async function ensureStudioKnowledgePersonnelRecord(prisma: any, input: {
  sourceKind: "packet_completion" | "policy_acceptance";
  sourceId: string;
  subjectUserId: string;
  actorUserId?: string | null;
  title: string;
  recordType: string;
  fields: Record<string, unknown>;
  effectiveAt?: Date | null;
}) {
  const existing = await prisma.personnelRecord.findUnique({ where: { sourceKind_sourceId: { sourceKind: input.sourceKind, sourceId: input.sourceId } } }).catch(() => null);
  if (existing) return existing;
  const at = input.effectiveAt || new Date();
  return prisma.personnelRecord.create({
    data: {
      subjectUserId: input.subjectUserId,
      createdById: input.actorUserId || input.subjectUserId,
      lastModifiedById: input.actorUserId || input.subjectUserId,
      title: input.title,
      recordType: input.recordType,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      status: "finalized",
      classification: "confidential",
      disclosurePolicy: "subject_visible",
      fieldsJson: JSON.stringify(input.fields || {}),
      effectiveAt: at,
      finalizedAt: at,
    },
  });
}
