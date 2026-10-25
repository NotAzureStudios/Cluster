import { buildSemanticCursorPage, decodeSemanticCursor, semanticCursorOrderBy, semanticCursorWhere, type ResolvedSemanticCursor } from "../../core/semantic-cursor-pagination.js";

type ProjectListOptions = {
  includeArchived: boolean;
  limit?: number;
};

type ProjectPageOptions = {
  includeArchived: boolean;
  limit: number;
  cursor?: string | null;
  sort: ResolvedSemanticCursor;
  where?: Record<string, unknown>;
};

const PROJECT_LIST_INCLUDE = {
  boards: {
    where: { archived: false },
    select: {
      id: true,
      name: true,
      description: true,
      assignedUserIds: true,
      backgroundColor: true,
      backgroundStyle: true,
      labelDefinitions: true,
      createdAt: true,
      updatedAt: true,
      revision: true,
      lists: {
        select: { id: true, title: true, assignedUserIds: true, isDone: true, collapsed: true },
        orderBy: { position: "asc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  },
  whiteboards: {
    select: {
      id: true,
      projectId: true,
      name: true,
      description: true,
      canvasWidth: true,
      canvasHeight: true,
      operationSequence: true,
      updatedAt: true,
      revision: true,
    },
  },
  memberships: {
    where: { status: "active" },
    select: {
      userId: true,
      roleKey: true,
      roleLabel: true,
      allocationPercent: true,
      accessLevel: true,
      isLead: true,
      status: true,
      startsAt: true,
      endsAt: true,
      createdAt: true,
    },
    orderBy: [{ isLead: "desc" }, { createdAt: "asc" }],
  },
  sourceBindings: {
    where: { archived: false },
    select: {
      id: true,
      repositoryId: true,
      role: true,
      branchRole: true,
      defaultBranch: true,
      policyOverrides: true,
      isPrimary: true,
      repository: {
        select: {
          id: true,
          name: true,
          hostingMode: true,
          remoteUrl: true,
          cloneUrl: true,
          defaultBranch: true,
          headRevision: true,
          syncState: true,
          lastSyncedAt: true,
          lastFetchAt: true,
          lastPushAt: true,
          healthState: true,
          healthMessage: true,
          metadata: true,
          connection: {
            select: { id: true, providerId: true, category: true, displayName: true, status: true, healthState: true },
          },
        },
      },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  },
  integrationBindings: {
    where: { archived: false },
    select: {
      id: true,
      connectionId: true,
      resourceType: true,
      externalId: true,
      externalUrl: true,
      displayName: true,
      metadata: true,
      isPrimary: true,
      connection: {
        select: { id: true, providerId: true, category: true, displayName: true, status: true, healthState: true },
      },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  },
  versions: {
    select: { id: true, label: true, stage: true, status: true, sourceRevision: true, buildId: true, releasedAt: true, createdAt: true, components: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
} as const;

const ACTIVE_ACCESS_RULE_SELECT = {
  targetKind: true,
  targetId: true,
  projectId: true,
  subjectKind: true,
  subjectId: true,
  subjectName: true,
  effect: true,
  level: true,
  status: true,
  expiresAt: true,
} as const;

export function createProjectRepository(prisma: any) {
  async function listProjects({ includeArchived, limit }: ProjectListOptions) {
    return prisma.project.findMany({
      where: includeArchived ? {} : { archived: false },
      include: PROJECT_LIST_INCLUDE,
      orderBy: { updatedAt: "desc" },
      ...(limit ? { take: limit } : {}),
    });
  }

  async function listProjectsPage({ includeArchived, limit, cursor, sort, where }: ProjectPageOptions) {
    const decoded = decodeSemanticCursor(cursor, sort);
    if (cursor && !decoded) throw Object.assign(new Error("Project cursor does not match the active semantic sort."), { code: "DATA_CURSOR_INVALID", statusCode: 400 });
    const cursorFilter = semanticCursorWhere(decoded, sort);
    const records = await prisma.project.findMany({
      where: {
        AND: [
          ...(includeArchived ? [] : [{ archived: false }]),
          ...(where ? [where] : []),
          ...(cursorFilter ? [cursorFilter] : []),
        ],
      },
      include: PROJECT_LIST_INCLUDE,
      orderBy: semanticCursorOrderBy(sort),
      take: limit + 1,
    });
    return buildSemanticCursorPage(records, limit, sort);
  }

  async function listActiveAccessRules() {
    return (await prisma.accessRule?.findMany?.({ where: { status: "active" }, select: ACTIVE_ACCESS_RULE_SELECT }).catch(() => [])) || [];
  }

  async function listActiveAccessRulesForProject(projectId: string) {
    return (await prisma.accessRule?.findMany?.({
      where: {
        status: "active",
        OR: [
          { projectId },
          { targetKind: "project", targetId: projectId },
        ],
      },
      select: ACTIVE_ACCESS_RULE_SELECT,
    }).catch(() => [])) || [];
  }

  return { listProjects, listProjectsPage, listActiveAccessRules, listActiveAccessRulesForProject };
}
