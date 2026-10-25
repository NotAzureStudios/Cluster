import { AUTHORIZATION_RULE_SELECT } from "../access/authorization.js";
import { WORKFORCE_USER_AUTHORITY_INCLUDE } from "../workforce/workforce-user-authority.js";

export type SearchCorpus = {
  projects: any[];
  users: any[];
  cards: any[];
  timelineItems: any[];
  calendarEvents: any[];
  cardComments: any[];
  activityEvents: any[];
  projectFiles: any[];
  videoAssets: any[];
  deliveryRecords: any[];
  sourceReviews: any[];
  sourceCommits: any[];
  projectRelationships: any[];
  packetDefinitions: any[];
  studioPolicies: any[];
  studioForms: any[];
  formSubmissions: any[];
  approvalRequests: any[];
  accessRules: any[];
  diagnostics?: { limits: Record<string, number>; saturatedKinds: string[] };
};

type ProjectSearchChildren = {
  boards: any[];
  whiteboards: any[];
  controlRecords: any[];
  libraryItems: any[];
};

export const SEARCH_CORPUS_LIMITS = Object.freeze({
  projects: 750,
  users: 2_500,
  boards: 4_000,
  whiteboards: 2_500,
  controlRecords: 12_000,
  libraryItems: 10_000,
  cards: 8_000,
  timelineItems: 4_000,
  calendarEvents: 4_000,
  cardComments: 6_000,
  activityEvents: 6_000,
  projectFiles: 3_000,
  videoAssets: 3_000,
  deliveryRecords: 8_000,
  sourceReviews: 3_000,
  sourceCommits: 3_000,
  projectRelationships: 20_000,
  packetDefinitions: 5_000,
  studioPolicies: 5_000,
  studioForms: 1_000,
  formSubmissions: 3_000,
  approvalRequests: 2_000,
});

const PROJECT_REFRESH_LIMITS = Object.freeze({
  boards: 750,
  whiteboards: 750,
  controlRecords: 3_000,
  libraryItems: 2_000,
  cards: 8_000,
  timelineItems: 4_000,
  calendarEvents: 4_000,
  cardComments: 6_000,
  activityEvents: 6_000,
  projectFiles: 3_000,
  videoAssets: 3_000,
  deliveryRecords: 4_000,
  sourceReviews: 1_000,
  sourceCommits: 1_000,
  projectRelationships: 8_000,
});

const searchUserNameSelect = { id: true, displayName: true, preferredName: true, username: true } as const;
const searchProjectRefSelect = { id: true, name: true, archived: true } as const;
const searchProjectAuthorizationSelect = {
  id: true,
  name: true,
  archived: true,
  memberships: {
    where: { status: "active" },
    select: { userId: true, roleKey: true, roleLabel: true, isLead: true },
  },
} as const;

const librarySearchSelect = {
  id: true,
  ownerId: true,
  source: true,
  projectId: true,
  parentId: true,
  title: true,
  body: true,
  previewText: true,
  type: true,
  status: true,
  priority: true,
  tags: true,
  originalName: true,
  mimeType: true,
  createdAt: true,
  updatedAt: true,
} as const;

function groupByProject(rows: any[]) {
  const grouped = new Map<string, any[]>();
  for (const row of rows) {
    const projectId = String(row?.projectId || "");
    if (!projectId) continue;
    const bucket = grouped.get(projectId) || [];
    bucket.push(row);
    grouped.set(projectId, bucket);
  }
  return grouped;
}

function attachProjectChildren(projects: any[], children: ProjectSearchChildren) {
  const boardsByProject = groupByProject(children.boards);
  const whiteboardsByProject = groupByProject(children.whiteboards);
  const controlsByProject = groupByProject(children.controlRecords);
  const libraryByProject = groupByProject(children.libraryItems);
  return projects.map((project) => ({
    ...project,
    boards: boardsByProject.get(String(project.id)) || [],
    whiteboards: whiteboardsByProject.get(String(project.id)) || [],
    controlRecords: controlsByProject.get(String(project.id)) || [],
    libraryItems: libraryByProject.get(String(project.id)) || [],
  }));
}

// Source reviews are Project resources; repository/binding health is checked
// again at live admission, never assumed from a cached Search title.
async function loadSourceReviews(prisma: any, projectIds: string[], limit: number) {
  if (!projectIds.length) return [];
  return prisma.sourceReview.findMany({
    where: { projectId: { in: projectIds }, repository: { archived: false } },
    select: {
      id: true, projectId: true, repositoryId: true, title: true, description: true,
      status: true, sourceBranch: true, targetBranch: true, createdAt: true, updatedAt: true,
      repository: { select: { id: true, name: true, archived: true, updatedAt: true } },
      project: { select: { sourceBindings: {
        where: { archived: false }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        take: 1, select: { repositoryId: true, updatedAt: true },
      } } },
    },
    orderBy: { updatedAt: "desc" }, take: limit,
  });
}

// A commit belongs to a repository, not a single Project. Materialize one
// bounded placement for each Project whose *active* Source tab points to it.
// The Search index uses a Project+commit identity; the canonical resource
// address continues to use the actual commit ID and the Project scope.
export async function loadSourceCommits(prisma: any, projectIds: string[], limit: number) {
  if (!projectIds.length || limit < 1) return [];
  // Load the one active binding per Project once. Never duplicate a shared
  // repository's entire list of Project bindings on each commit row.
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds }, archived: false },
    select: { id: true, sourceBindings: {
      where: { archived: false }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      take: 1, select: { id: true, repositoryId: true, updatedAt: true,
        repository: { select: { id: true, name: true, archived: true, updatedAt: true } },
      },
    } },
  });
  const byRepository = new Map<string, any[]>();
  for (const project of projects) {
    const binding = project.sourceBindings?.[0];
    if (!binding || !binding.repository || binding.repository.archived) continue;
    const key = String(binding.repositoryId);
    const placements = byRepository.get(key) || [];
    placements.push({ projectId: String(project.id), binding });
    byRepository.set(key, placements);
  }
  if (!byRepository.size) return [];
  const commits = await prisma.sourceCommit.findMany({
    where: { repositoryId: { in: [...byRepository.keys()] } },
    select: {
      id: true, repositoryId: true, revision: true, shortRevision: true,
      message: true, authorName: true, committedAt: true, createdAt: true, updatedAt: true,
      repository: { select: { id: true, name: true, archived: true, updatedAt: true } },
    },
    orderBy: { updatedAt: "desc" }, take: limit,
  });
  const placed: any[] = [];
  for (const commit of commits) {
    if (commit.repository?.archived) continue;
    for (const placement of byRepository.get(String(commit.repositoryId)) || []) {
      const binding = placement.binding;
      placed.push({ ...commit, projectId: placement.projectId,
        binding: { id: binding.id, repositoryId: binding.repositoryId, updatedAt: binding.updatedAt },
      });
      if (placed.length >= limit) return placed;
    }
  }
  return placed;
}

async function loadDeliverySearchRecords(prisma: any, where: Record<string, any>, limit: number) {
  const perKind = Math.max(100, Math.ceil(limit / 4));
  const [builds, qaPlans, qaSessions, releases] = await Promise.all([
    prisma.deliveryBuild.findMany({ where: { ...where, archived: false }, orderBy: { updatedAt: "desc" }, take: perKind }),
    prisma.deliveryQaPlan.findMany({ where: { ...where, archived: false }, orderBy: { updatedAt: "desc" }, take: perKind }),
    prisma.deliveryQaSession.findMany({ where: { ...where, archived: false }, include: { build: { select: { version: true, title: true } } }, orderBy: { updatedAt: "desc" }, take: perKind }),
    prisma.deliveryRelease.findMany({ where: { ...where, archived: false }, include: { build: { select: { version: true, title: true } } }, orderBy: { updatedAt: "desc" }, take: perKind }),
  ]);
  return [
    ...builds.map((row: any) => ({ ...row, deliveryKind: "build" })),
    ...qaPlans.map((row: any) => ({ ...row, deliveryKind: "qa_plan" })),
    ...qaSessions.map((row: any) => ({ ...row, deliveryKind: "qa_session" })),
    ...releases.map((row: any) => ({ ...row, deliveryKind: "release" })),
  ].sort((a: any, b: any) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()).slice(0, limit);
}

export function createSearchRepository(prisma: any) {
  async function loadCorpus(): Promise<SearchCorpus> {
    const projects = await prisma.project.findMany({
      where: { archived: false },
      include: { memberships: { where: { status: "active" }, select: { userId: true, roleKey: true, roleLabel: true, isLead: true } } },
      orderBy: { updatedAt: "desc" },
      take: SEARCH_CORPUS_LIMITS.projects,
    });
    const projectIds = projects.map((project: any) => String(project.id)).filter(Boolean);
    const projectWhere = projectIds.length ? { projectId: { in: projectIds } } : { projectId: "__cluster_no_projects__" };
    const [
      users,
      boards,
      whiteboards,
      controlRecords,
      libraryItems,
      cards,
      timelineItems,
      calendarEvents,
      cardComments,
      activityEvents,
      projectFiles,
      videoAssets,
      deliveryRecords,
      sourceReviews,
      sourceCommits,
      projectRelationships,
      packetDefinitions,
      studioPolicies,
      studioForms,
      formSubmissions,
      approvalRequests,
      accessRules,
    ] = await Promise.all([
      prisma.user.findMany({
        where: { archived: false },
        include: { ...WORKFORCE_USER_AUTHORITY_INCLUDE, memberships: { select: { workspaceId: true, role: true } } },
        orderBy: { updatedAt: "desc" },
        take: SEARCH_CORPUS_LIMITS.users,
      }),
      prisma.board.findMany({
        where: { ...projectWhere, archived: false },
        orderBy: { updatedAt: "desc" },
        take: SEARCH_CORPUS_LIMITS.boards,
      }),
      prisma.whiteboard.findMany({
        where: projectWhere,
        orderBy: { updatedAt: "desc" },
        take: SEARCH_CORPUS_LIMITS.whiteboards,
      }),
      prisma.projectControlRecord.findMany({
        where: { ...projectWhere, archived: false },
        orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
        take: SEARCH_CORPUS_LIMITS.controlRecords,
      }),
      prisma.libraryItem.findMany({
        where: { ...projectWhere, status: { not: "archived" } },
        select: librarySearchSelect,
        orderBy: { updatedAt: "desc" },
        take: SEARCH_CORPUS_LIMITS.libraryItems,
      }),
      prisma.card.findMany({
        where: { archived: false, list: { archived: false, board: { projectId: { in: projectIds } } } },
        include: {
          assignee: { select: searchUserNameSelect },
          _count: { select: { comments: true, checklistItems: true } },
          list: { include: { board: { include: { project: { select: searchProjectRefSelect } } } } },
        },
        orderBy: { updatedAt: "desc" },
        take: SEARCH_CORPUS_LIMITS.cards,
      }),
      prisma.timelineItem.findMany({
        where: { projectId: { in: projectIds } },
        include: { project: { select: searchProjectRefSelect }, user: { select: searchUserNameSelect } },
        orderBy: { updatedAt: "desc" },
        take: SEARCH_CORPUS_LIMITS.timelineItems,
      }),
      prisma.calendarEvent.findMany({
        where: { projectId: { in: projectIds } },
        include: { project: { select: searchProjectRefSelect } },
        orderBy: { updatedAt: "desc" },
        take: SEARCH_CORPUS_LIMITS.calendarEvents,
      }),
      prisma.cardComment.findMany({
        where: { card: { list: { board: { projectId: { in: projectIds } } } } },
        include: {
          user: { select: searchUserNameSelect },
          card: { include: { list: { include: { board: { include: { project: { select: searchProjectRefSelect } } } } } } },
        },
        orderBy: { createdAt: "desc" },
        take: SEARCH_CORPUS_LIMITS.cardComments,
      }),
      prisma.activityEvent.findMany({
        where: { projectId: { in: projectIds } },
        include: { user: { select: searchUserNameSelect }, project: { select: searchProjectAuthorizationSelect } },
        orderBy: { createdAt: "desc" },
        take: SEARCH_CORPUS_LIMITS.activityEvents,
      }),
      prisma.projectFile.findMany({
        where: { projectId: { in: projectIds }, archived: false },
        include: { project: { select: searchProjectRefSelect } },
        orderBy: { updatedAt: "desc" },
        take: SEARCH_CORPUS_LIMITS.projectFiles,
      }),
      prisma.reviewAsset.findMany({
        where: { projectId: { in: projectIds } },
        include: { project: { select: searchProjectRefSelect } },
        orderBy: { updatedAt: "desc" },
        take: SEARCH_CORPUS_LIMITS.videoAssets,
      }),
      loadDeliverySearchRecords(prisma, { projectId: { in: projectIds } }, SEARCH_CORPUS_LIMITS.deliveryRecords),
      loadSourceReviews(prisma, projectIds, SEARCH_CORPUS_LIMITS.sourceReviews),
      loadSourceCommits(prisma, projectIds, SEARCH_CORPUS_LIMITS.sourceCommits),
      prisma.projectRelationship.findMany({
        where: { projectId: { in: projectIds } },
        orderBy: { createdAt: "desc" },
        take: SEARCH_CORPUS_LIMITS.projectRelationships,
      }),
      prisma.packetDefinition.findMany({
        where: { libraryFolder: { status: { notIn: ["archived", "trashed"] } } },
        include: { libraryFolder: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } },
        orderBy: { updatedAt: "desc" },
        take: SEARCH_CORPUS_LIMITS.packetDefinitions,
      }),
      prisma.studioPolicy.findMany({
        where: { status: "active" },
        include: { versions: { where: { status: "published" }, orderBy: { version: "desc" }, take: 1 } },
        orderBy: { updatedAt: "desc" },
        take: SEARCH_CORPUS_LIMITS.studioPolicies,
      }),
      // Administrative discovery only. Index metadata, NEVER respondent names,
      // email addresses, answers or reviewer notes. ACLs are evaluated afresh.
      prisma.studioForm.findMany({
        select: { id: true, key: true, title: true, purpose: true, status: true, updatedAt: true, createdAt: true },
        orderBy: { updatedAt: "desc" }, take: SEARCH_CORPUS_LIMITS.studioForms,
      }),
      prisma.studioFormSubmission.findMany({
        where: { form: { purpose: { not: "application" } } },
        select: { id: true, formId: true, status: true, submittedAt: true, updatedAt: true,
          form: { select: { id: true, title: true, purpose: true, status: true, updatedAt: true } } },
        orderBy: { submittedAt: "desc" }, take: SEARCH_CORPUS_LIMITS.formSubmissions,
      }),
      // Do not query approval payloads, requester identity or notes into Search.
      prisma.clusterPersistenceRecord.findMany({
        where: { kind: "approvalRequest", archived: false, deletedAt: null },
        select: { id: true, kind: true, title: true, status: true, archived: true, updatedAt: true, createdAt: true },
        orderBy: { updatedAt: "desc" }, take: SEARCH_CORPUS_LIMITS.approvalRequests,
      }),
      prisma.accessRule.findMany({ where: { status: "active" }, select: AUTHORIZATION_RULE_SELECT }),
    ]);
    return {
      projects: attachProjectChildren(projects, { boards, whiteboards, controlRecords, libraryItems }),
      users,
      cards,
      timelineItems,
      calendarEvents,
      cardComments,
      activityEvents,
      projectFiles,
      videoAssets,
      deliveryRecords,
      sourceReviews,
      sourceCommits,
      projectRelationships,
      packetDefinitions,
      studioPolicies,
      studioForms,
      formSubmissions,
      approvalRequests,
      accessRules,
      diagnostics: {
        limits: { ...SEARCH_CORPUS_LIMITS },
        saturatedKinds: [
          ["projects", projects.length, SEARCH_CORPUS_LIMITS.projects],
          ["users", users.length, SEARCH_CORPUS_LIMITS.users],
          ["boards", boards.length, SEARCH_CORPUS_LIMITS.boards],
          ["whiteboards", whiteboards.length, SEARCH_CORPUS_LIMITS.whiteboards],
          ["controlRecords", controlRecords.length, SEARCH_CORPUS_LIMITS.controlRecords],
          ["libraryItems", libraryItems.length, SEARCH_CORPUS_LIMITS.libraryItems],
          ["cards", cards.length, SEARCH_CORPUS_LIMITS.cards],
          ["timelineItems", timelineItems.length, SEARCH_CORPUS_LIMITS.timelineItems],
          ["calendarEvents", calendarEvents.length, SEARCH_CORPUS_LIMITS.calendarEvents],
          ["cardComments", cardComments.length, SEARCH_CORPUS_LIMITS.cardComments],
          ["activityEvents", activityEvents.length, SEARCH_CORPUS_LIMITS.activityEvents],
          ["projectFiles", projectFiles.length, SEARCH_CORPUS_LIMITS.projectFiles],
          ["videoAssets", videoAssets.length, SEARCH_CORPUS_LIMITS.videoAssets],
          ["deliveryRecords", deliveryRecords.length, SEARCH_CORPUS_LIMITS.deliveryRecords],
          ["sourceReviews", sourceReviews.length, SEARCH_CORPUS_LIMITS.sourceReviews],
          ["studioForms", studioForms.length, SEARCH_CORPUS_LIMITS.studioForms],
          ["formSubmissions", formSubmissions.length, SEARCH_CORPUS_LIMITS.formSubmissions],
          ["approvalRequests", approvalRequests.length, SEARCH_CORPUS_LIMITS.approvalRequests],
          ["sourceCommits", sourceCommits.length, SEARCH_CORPUS_LIMITS.sourceCommits],
          ["projectRelationships", projectRelationships.length, SEARCH_CORPUS_LIMITS.projectRelationships],
          ["packetDefinitions", packetDefinitions.length, SEARCH_CORPUS_LIMITS.packetDefinitions],
          ["studioPolicies", studioPolicies.length, SEARCH_CORPUS_LIMITS.studioPolicies],
        ].filter(([, count, limit]) => Number(count) >= Number(limit)).map(([kind]) => String(kind)),
      },
    };
  }

  async function loadProjectCorpus(projectId: string): Promise<SearchCorpus> {
    const [project, boards, whiteboards, controlRecords, libraryItems, cards, timelineItems, calendarEvents, cardComments, activityEvents, projectFiles, videoAssets, deliveryRecords, sourceReviews, sourceCommits, projectRelationships, accessRules] = await Promise.all([
      prisma.project.findFirst({
        where: { id: projectId, archived: false },
        include: { memberships: { where: { status: "active" }, select: { userId: true, roleKey: true, roleLabel: true, isLead: true } } },
      }),
      prisma.board.findMany({ where: { projectId, archived: false }, orderBy: { updatedAt: "desc" }, take: PROJECT_REFRESH_LIMITS.boards }),
      prisma.whiteboard.findMany({ where: { projectId }, orderBy: { updatedAt: "desc" }, take: PROJECT_REFRESH_LIMITS.whiteboards }),
      prisma.projectControlRecord.findMany({ where: { projectId, archived: false }, orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }], take: PROJECT_REFRESH_LIMITS.controlRecords }),
      prisma.libraryItem.findMany({ where: { projectId, status: { not: "archived" } }, select: librarySearchSelect, orderBy: { updatedAt: "desc" }, take: PROJECT_REFRESH_LIMITS.libraryItems }),
      prisma.card.findMany({
        where: { archived: false, list: { board: { projectId } } },
        include: { assignee: { select: searchUserNameSelect }, _count: { select: { comments: true, checklistItems: true } }, list: { include: { board: { include: { project: { select: searchProjectRefSelect } } } } } },
        orderBy: { updatedAt: "desc" },
        take: PROJECT_REFRESH_LIMITS.cards,
      }),
      prisma.timelineItem.findMany({ where: { projectId }, include: { project: { select: searchProjectRefSelect }, user: { select: searchUserNameSelect } }, orderBy: { updatedAt: "desc" }, take: PROJECT_REFRESH_LIMITS.timelineItems }),
      prisma.calendarEvent.findMany({ where: { projectId }, include: { project: { select: searchProjectRefSelect } }, orderBy: { updatedAt: "desc" }, take: PROJECT_REFRESH_LIMITS.calendarEvents }),
      prisma.cardComment.findMany({
        where: { card: { list: { board: { projectId } } } },
        include: { user: { select: searchUserNameSelect }, card: { include: { list: { include: { board: { include: { project: { select: searchProjectRefSelect } } } } } } } },
        orderBy: { createdAt: "desc" },
        take: PROJECT_REFRESH_LIMITS.cardComments,
      }),
      prisma.activityEvent.findMany({ where: { projectId }, include: { user: { select: searchUserNameSelect }, project: { select: searchProjectAuthorizationSelect } }, orderBy: { createdAt: "desc" }, take: PROJECT_REFRESH_LIMITS.activityEvents }),
      prisma.projectFile.findMany({ where: { projectId, archived: false }, include: { project: { select: searchProjectRefSelect } }, orderBy: { updatedAt: "desc" }, take: PROJECT_REFRESH_LIMITS.projectFiles }),
      prisma.reviewAsset.findMany({ where: { projectId }, include: { project: { select: searchProjectRefSelect } }, orderBy: { updatedAt: "desc" }, take: PROJECT_REFRESH_LIMITS.videoAssets }),
      loadDeliverySearchRecords(prisma, { projectId }, PROJECT_REFRESH_LIMITS.deliveryRecords),
      loadSourceReviews(prisma, [projectId], PROJECT_REFRESH_LIMITS.sourceReviews),
      loadSourceCommits(prisma, [projectId], PROJECT_REFRESH_LIMITS.sourceCommits),
      prisma.projectRelationship.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: PROJECT_REFRESH_LIMITS.projectRelationships }),
      prisma.accessRule.findMany({ where: { status: "active", OR: [{ projectId }, { targetKind: "project", targetId: projectId }] }, select: AUTHORIZATION_RULE_SELECT }),
    ]);
    return {
      projects: project ? attachProjectChildren([project], { boards, whiteboards, controlRecords, libraryItems }) : [],
      users: [],
      cards,
      timelineItems,
      calendarEvents,
      cardComments,
      activityEvents,
      projectFiles,
      videoAssets,
      deliveryRecords,
      sourceReviews,
      sourceCommits,
      projectRelationships,
      packetDefinitions: [],
      studioPolicies: [],
      studioForms: [],
      formSubmissions: [],
      approvalRequests: [],
      accessRules,
    };
  }


  async function loadUserCorpus(userId: string): Promise<SearchCorpus> {
    const user = await prisma.user.findFirst({
      where: { id: userId, archived: false },
      // Match the full-corpus People projection during incremental refresh.
      include: { ...WORKFORCE_USER_AUTHORITY_INCLUDE, memberships: { select: { workspaceId: true, role: true } } },
    });
    return {
      projects: [],
      users: user ? [user] : [],
      cards: [],
      timelineItems: [],
      calendarEvents: [],
      cardComments: [],
      activityEvents: [],
      projectFiles: [],
      videoAssets: [],
      deliveryRecords: [],
      sourceReviews: [],
      sourceCommits: [],
      projectRelationships: [],
      packetDefinitions: [],
      studioPolicies: [],
      studioForms: [],
      formSubmissions: [],
      approvalRequests: [],
      accessRules: [],
    };
  }

  async function loadAccessRules() {
    // An ACL repository outage must fail the search, not yield an empty rule set.
    return prisma.accessRule.findMany({ where: { status: "active" }, select: AUTHORIZATION_RULE_SELECT });
  }

  return { loadCorpus, loadProjectCorpus, loadUserCorpus, loadAccessRules };
}
