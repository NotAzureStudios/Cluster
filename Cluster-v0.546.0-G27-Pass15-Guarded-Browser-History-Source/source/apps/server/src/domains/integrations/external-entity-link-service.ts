function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function serializeLink(row: any) {
  return { ...row, metadata: parseObject(row.metadata) };
}

export function createExternalEntityLinkService(prisma: any) {
  async function listForEntities(entityType: string, entityIds: string[]) {
    const ids = Array.from(new Set(entityIds.filter(Boolean)));
    if (!ids.length) return new Map<string, any[]>();
    const rows = await prisma.externalEntityLink.findMany({
      where: { entityType, entityId: { in: ids } },
      orderBy: { updatedAt: "desc" },
    });
    const result = new Map<string, any[]>();
    for (const row of rows) {
      const existing = result.get(row.entityId) || [];
      existing.push(serializeLink(row));
      result.set(row.entityId, existing);
    }
    return result;
  }

  async function decorateEntities<T extends { id: string }>(entityType: string, entities: T[]) {
    const byEntity = await listForEntities(entityType, entities.map((entity) => entity.id));
    return entities.map((entity) => ({ ...entity, externalLinks: byEntity.get(entity.id) || [] }));
  }

  async function decorateCards<T extends { id: string }>(cards: T[]) {
    return decorateEntities("card", cards);
  }

  async function listForEntity(entityType: string, entityId: string) {
    const rows = await prisma.externalEntityLink.findMany({ where: { entityType, entityId }, orderBy: { updatedAt: "desc" } });
    return rows.map(serializeLink);
  }

  async function upsert(input: {
    workspaceId: string;
    projectId?: string | null;
    connectionId?: string | null;
    entityType: string;
    entityId: string;
    providerEntityType: string;
    providerEntityId: string;
    providerUrl?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const identity = {
      workspaceId: input.workspaceId,
      entityType: input.entityType,
      entityId: input.entityId,
      providerEntityType: input.providerEntityType,
      providerEntityId: input.providerEntityId,
    };
    const row = await prisma.externalEntityLink.upsert({
      where: { workspaceId_entityType_entityId_providerEntityType_providerEntityId: identity },
      create: {
        ...identity,
        projectId: input.projectId || null,
        connectionId: input.connectionId || null,
        providerUrl: input.providerUrl || null,
        metadata: JSON.stringify(input.metadata || {}),
      },
      update: {
        projectId: input.projectId || null,
        connectionId: input.connectionId || null,
        providerUrl: input.providerUrl || null,
        metadata: JSON.stringify(input.metadata || {}),
      },
    });
    return serializeLink(row);
  }

  async function replaceProviderEntity(input: {
    workspaceId: string;
    projectId?: string | null;
    connectionId?: string | null;
    entityType: string;
    entityId: string;
    providerEntityType: string;
    providerEntityId: string;
    providerUrl?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    await prisma.externalEntityLink.deleteMany({
      where: {
        workspaceId: input.workspaceId,
        entityType: input.entityType,
        entityId: input.entityId,
        providerEntityType: input.providerEntityType,
      },
    });
    return upsert(input);
  }

  async function removeProviderEntity(workspaceId: string, entityType: string, entityId: string, providerEntityType: string) {
    await prisma.externalEntityLink.deleteMany({ where: { workspaceId, entityType, entityId, providerEntityType } });
  }

  return { listForEntities, decorateEntities, decorateCards, listForEntity, upsert, replaceProviderEntity, removeProviderEntity };
}

export type ExternalEntityLinkService = ReturnType<typeof createExternalEntityLinkService>;
