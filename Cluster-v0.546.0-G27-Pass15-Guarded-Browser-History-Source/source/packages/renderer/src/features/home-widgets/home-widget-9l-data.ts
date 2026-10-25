import type { CustomHomeWidgetRuntimeData, CustomHomeWidgetListItem } from "./CustomHomeWidget";

export type Widget21Project = { id: string; name: string; updatedAt?: string; boards?: Array<{ id: string; name: string }>; whiteboards?: Array<{ id: string; name: string; updatedAt?: string }> };
export type Widget21Card = { id: string; title: string; projectId?: string | null; projectName?: string; boardName?: string; dueDate?: string | null; priority?: string | null; userId?: string | null; ownerId?: string | null };
export type Widget21Person = { id: string; username: string; displayName?: string | null; title?: string | null; workspaceRole?: string | null; lastSeenAt?: string | null; lastActivityAt?: string | null; capacityHours?: number | null };
export type Widget21Knowledge = { id: string; title: string; type?: string | null; status?: string | null; projectId?: string | null; updatedAt?: string | null };
export type Widget21KnowledgeAssignment = { id: string; title: string; kind: "packet" | "policy"; dueAt?: string | null; overdue: boolean; resourceId: string };
export type Widget21Recurring = { id: string; title: string; projectId?: string | null; nextRun: string; status: string; ownerId?: string | null; ownerName?: string | null };
export type Widget21Repository = { id: string; name: string; healthState?: string | null; defaultBranch?: string | null; _count?: { branches?: number } };
export type Widget21Review = { id: string; title: string; projectId: string; projectName: string; sourceBranch: string; targetBranch: string; updatedAt: string; myDecision?: string | null };
export type Widget21Attention = { id: string; title: string; detail: string; target?: string; source?: string; severity?: string };

type Input = {
  projects: Widget21Project[];
  boardCount: number;
  whiteboardCount: number;
  assignedCards: Widget21Card[];
  openCards: Widget21Card[];
  people: Widget21Person[];
  activePeopleIds: Set<string>;
  capacityPressure: number;
  weekMinutes: number;
  runningTimers: number;
  activityItems: Array<{ id: string; title: string; detail?: string; at?: string | null; projectId?: string | null; userId?: string | null }>;
  attentionItems: Widget21Attention[];
  buildItems: Array<{ id: string; title: string; detail: string; projectId?: string | null; at?: string | null; failed?: boolean }>;
  qaItems: Array<{ id: string; title: string; detail: string; projectId?: string | null; at?: string | null; failed?: boolean; blocked?: boolean }>;
  ticketItems: Array<{ id: string; title: string; detail: string; projectId?: string | null; priority?: string | null; at?: string | null }>;
  upcomingItems: Array<{ id: string; title: string; detail: string; projectId?: string | null; at?: string | null }>;
  libraryItems: Widget21Knowledge[];
  libraryTotal: number;
  libraryPinned: number;
  knowledgeAssignments: Widget21KnowledgeAssignment[];
  recurring: Widget21Recurring[];
  repositories: Widget21Repository[];
  reviews: Widget21Review[];
  delivery: { total: number; ready: number; blocked: number };
};

function listItem(item: CustomHomeWidgetListItem) { return item; }

export function buildWidget21RuntimeData(input: Input): CustomHomeWidgetRuntimeData {
  const activePeople = input.people.filter((person) => input.activePeopleIds.has(person.id));
  const securityAttention = input.attentionItems.filter((item) => `${item.title} ${item.detail} ${item.source || ""}`.toLowerCase().includes("security"));
  const operationsAttention = input.attentionItems.filter((item) => item.target === "admin" || item.source === "maintenance" || securityAttention.includes(item));
  const recentWhiteboards = input.projects.flatMap((project) => (project.whiteboards || []).map((board) => listItem({ id: board.id, title: board.name, detail: project.name, projectId: project.id, at: board.updatedAt || project.updatedAt || null })));
  recentWhiteboards.sort((a, b) => Date.parse(b.at || "") - Date.parse(a.at || ""));
  const assignedCards = input.assignedCards.map((card) => listItem({ id: card.id, title: card.title, detail: `${card.projectName || "Project"}${card.boardName ? ` · ${card.boardName}` : ""}`, projectId: card.projectId || null, userId: card.userId || card.ownerId || null, at: card.dueDate || null }));
  const requiredKnowledge = input.knowledgeAssignments.map((item) => listItem({ id: item.id, title: item.title, detail: item.kind === "policy" ? "Policy" : "Packet", at: item.dueAt || null }));
  const recurringItems = input.recurring.filter((item) => item.status === "active").sort((a, b) => Date.parse(a.nextRun) - Date.parse(b.nextRun)).map((item) => listItem({ id: item.id, title: item.title, detail: item.ownerName || "Recurring work", projectId: item.projectId || null, userId: item.ownerId || null, at: item.nextRun }));
  const repositoryItems = input.repositories.map((repo) => listItem({ id: repo.id, title: repo.name, detail: `${repo.defaultBranch || "main"} · ${repo._count?.branches || 0} branches`, value: repo.healthState || "unknown" }));
  const reviewItems = input.reviews.map((review) => listItem({ id: review.id, title: review.title, detail: `${review.projectName} · ${review.sourceBranch} → ${review.targetBranch}`, projectId: review.projectId, at: review.updatedAt, value: review.myDecision || "Review" }));
  return {
    metrics: {
      "projects.total": input.projects.length,
      "projects.ready": Math.max(0, input.projects.length - input.attentionItems.filter((item) => item.target === "projects").length),
      "projects.needsAttention": input.attentionItems.filter((item) => item.target === "projects").length,
      "boards.total": input.boardCount,
      "cards.open": input.openCards.length,
      "cards.assigned": input.assignedCards.length,
      "whiteboards.total": input.whiteboardCount,
      "scheduler.weekMinutes": input.weekMinutes,
      "scheduler.running": input.runningTimers,
      "activity.recent": input.activityItems.length,
      "inbox.attention": input.attentionItems.length,
      "inbox.urgent": input.attentionItems.filter((item) => ["critical", "high"].includes(item.severity || "")).length,
      "people.total": input.people.length,
      "people.active": activePeople.length,
      "people.capacityPressure": input.capacityPressure,
      "builds.total": input.buildItems.length,
      "builds.failed": input.buildItems.filter((item) => item.failed).length,
      "qa.total": input.qaItems.length,
      "qa.failed": input.qaItems.filter((item) => item.failed).length,
      "qa.blocked": input.qaItems.filter((item) => item.blocked).length,
      "tickets.open": input.ticketItems.length,
      "tickets.priority": input.ticketItems.filter((item) => ["urgent", "high"].includes(item.priority || "")).length,
      "calendar.upcoming": input.upcomingItems.length,
      "library.total": input.libraryTotal,
      "library.pinned": input.libraryPinned,
      "packets.required": input.knowledgeAssignments.length,
      "packets.overdue": input.knowledgeAssignments.filter((item) => item.overdue).length,
      "automation.recurring": recurringItems.length,
      "source.repositories": input.repositories.length,
      "source.reviews": input.reviews.length,
      "delivery.ready": input.delivery.ready,
      "delivery.blocked": input.delivery.blocked,
      "operations.attention": operationsAttention.length,
      "operations.security": securityAttention.length,
    },
    lists: {
      "projects.recent": input.projects.slice().sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || "")).slice(0, 12).map((project) => listItem({ id: project.id, title: project.name, detail: `${project.boards?.length || 0} boards · ${project.whiteboards?.length || 0} whiteboards`, projectId: project.id, at: project.updatedAt || null })),
      "boards.assignedCards": assignedCards,
      "whiteboards.recent": recentWhiteboards.slice(0, 12),
      "activity.recentItems": input.activityItems.map((item) => listItem(item)),
      "people.activePeople": activePeople.map((person) => listItem({ id: person.id, title: person.displayName || person.username, detail: person.title || person.workspaceRole || "Person", userId: person.id, roleId: person.workspaceRole || null, at: person.lastActivityAt || person.lastSeenAt || null })),
      "builds.recent": input.buildItems.map((item) => listItem(item)),
      "qa.active": input.qaItems.map((item) => listItem(item)),
      "tickets.openItems": input.ticketItems.map((item) => listItem(item)),
      "calendar.upcomingItems": input.upcomingItems.map((item) => listItem(item)),
      "library.recent": input.libraryItems.map((item) => listItem({ id: item.id, title: item.title, detail: `${item.type || "Item"} · ${item.status || "active"}`, projectId: item.projectId || null, at: item.updatedAt || null })),
      "packets.requiredItems": requiredKnowledge,
      "automation.recurringItems": recurringItems,
      "source.repositoriesItems": repositoryItems,
      "source.reviewItems": reviewItems,
      "operations.attentionItems": operationsAttention.map((item) => listItem({ id: item.id, title: item.title, detail: item.detail, tone: item.severity === "critical" || item.severity === "high" ? "danger" : "warning" })),
    },
  };
}

import type { BuiltInHomeWidgetData } from "./BuiltInHomeWidget";

export function buildWidget21DashboardRuntimeData(input: {
  projects: Widget21Project[];
  boardCount: number;
  whiteboardCount: number;
  assignedCards: Widget21Card[];
  people: Widget21Person[];
  activePeopleIds: Set<string>;
  knowledgeAssignments: Widget21KnowledgeAssignment[];
  recurring: Widget21Recurring[];
  repositories: Widget21Repository[];
  reviews: Widget21Review[];
  attentionItems: Widget21Attention[];
  builtIn: BuiltInHomeWidgetData;
  weekMinutes: number;
  runningTimers: number;
}): CustomHomeWidgetRuntimeData {
  const builtIn = input.builtIn;
  return buildWidget21RuntimeData({
    projects: input.projects,
    boardCount: input.boardCount,
    whiteboardCount: input.whiteboardCount,
    assignedCards: input.assignedCards,
    openCards: builtIn.tickets.items.map((item) => ({ id: item.id, title: item.title, projectId: item.workTarget?.projectId || null, projectName: item.detail || "", dueDate: item.at || null })),
    people: input.people,
    activePeopleIds: input.activePeopleIds,
    capacityPressure: builtIn.peopleCapacity.pressured,
    weekMinutes: input.weekMinutes,
    runningTimers: input.runningTimers,
    activityItems: builtIn.activity.map((item) => ({ id: item.id, title: item.title, detail: item.detail, at: item.at || null, projectId: item.projectId || item.workTarget?.projectId || null, userId: item.userId || null })),
    attentionItems: input.attentionItems,
    buildItems: builtIn.builds.items.map((item) => ({ id: item.id, title: item.title, detail: item.detail || "Build", projectId: item.projectId || item.workTarget?.projectId || null, at: item.at || null, failed: String(item.value || "").toLowerCase().includes("fail") || String(item.value || "").toLowerCase().includes("block") })),
    qaItems: builtIn.qa.items.map((item) => ({ id: item.id, title: item.title, detail: item.detail || "QA", projectId: item.projectId || item.workTarget?.projectId || null, at: item.at || null, failed: String(item.value || "").toLowerCase().includes("fail"), blocked: String(item.value || "").toLowerCase().includes("block") })),
    ticketItems: builtIn.tickets.items.map((item) => ({ id: item.id, title: item.title, detail: item.detail || "Ticket", projectId: item.projectId || item.workTarget?.projectId || null, priority: String(item.value || ""), at: item.at || null })),
    upcomingItems: builtIn.upcoming.map((item) => ({ id: item.id, title: item.title, detail: item.detail || "Upcoming", projectId: item.projectId || item.workTarget?.projectId || null, at: item.at || null })),
    libraryItems: builtIn.library.recent.map((item) => ({ id: item.id, title: item.title, status: item.detail || null, projectId: item.projectId || item.workTarget?.projectId || null, updatedAt: item.at || null })),
    libraryTotal: builtIn.library.total,
    libraryPinned: builtIn.library.pinned,
    knowledgeAssignments: input.knowledgeAssignments,
    recurring: input.recurring,
    repositories: input.repositories,
    reviews: input.reviews,
    delivery: { total: builtIn.releaseReadiness.total, ready: builtIn.releaseReadiness.ready, blocked: builtIn.releaseReadiness.blocked },
  });
}
