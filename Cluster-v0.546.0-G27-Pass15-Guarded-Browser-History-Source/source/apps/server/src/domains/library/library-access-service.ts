import type { FastifyRequest } from "fastify";

export type LibraryAccessLevel = "view" | "contribute" | "edit" | "manage";

export type LibraryAccessContext = {
  user: any | null;
  decorated: any;
  rules: any[];
  folderPermissions: any[];
  folderParents: Map<string, string | null>;
};

export type LibraryAccessExplanation = {
  allowed: boolean;
  required: LibraryAccessLevel;
  effectiveAccess: LibraryAccessLevel | "none";
  reasonCode: "AUTH_REQUIRED" | "ADMIN_OVERRIDE" | "OWNER" | "FOLDER_GRANT" | "TARGET_POLICY" | "DENY";
  contributors: Array<{ kind: string; id?: string | null; access?: string | null; inherited?: boolean; detail: string }>;
};

type LibraryAccessDependencies = {
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  decorateUserForClient: (user: any) => Promise<any>;
  hasTargetAccess: (
    user: any,
    role: string | null | undefined,
    targetKind: string,
    targetId: string,
    project: any | null | undefined,
    rules: any[],
    minimum?: string,
  ) => boolean;
};

const FOLDER_ACCESS_RANK: Record<string, number> = { none: 0, view: 1, contribute: 2, edit: 3, manage: 4 };
const ACCESS_BY_RANK: Array<LibraryAccessLevel | "none"> = ["none", "view", "contribute", "edit", "manage"];

/**
 * Canonical Library item authorization, including inherited folder ACLs.
 *
 * Cross-domain features must use this service rather than infer access from
 * paths, ownership strings, or project membership alone. 9E additionally
 * exposes explainable access evidence for the Library permission inspector.
 */
export function createLibraryAccessService({ prisma, getCurrentUser, decorateUserForClient, hasTargetAccess }: LibraryAccessDependencies) {
  const contextCache = new WeakMap<FastifyRequest, Promise<LibraryAccessContext>>();
  const itemCache = new WeakMap<FastifyRequest, Map<string, Promise<any | null>>>();

  async function contextForUser(user: any | null, db: any = prisma, options: { strict?: boolean } = {}): Promise<LibraryAccessContext> {
    // Streaming visibility is security-sensitive: a failed ACL/folder read must
    // abort delivery, not silently grant inherited project visibility.
    const decorated = await decorateUserForClient(user);
    if (options.strict && user && !decorated?.isAdmin) {
      if (typeof (db as any).accessRule?.findMany !== "function"
        || typeof (db as any).folderPermission?.findMany !== "function"
        || typeof (db as any).libraryItem?.findMany !== "function") throw new Error("Library access providers are unavailable.");
    }
    const [rules, folderPermissions, folderRows] = await Promise.all([
      decorated?.isAdmin
        ? Promise.resolve([])
        : (options.strict
          ? (db as any).accessRule.findMany({ where: { status: "active" } })
          : ((db as any).accessRule?.findMany?.({ where: { status: "active" } }).catch(() => []) || Promise.resolve([]))),
      user && !decorated?.isAdmin
        ? (options.strict
          ? (db as any).folderPermission.findMany({ where: { userId: user.id } })
          : (db as any).folderPermission.findMany({ where: { userId: user.id } }).catch(() => []))
        : Promise.resolve([]),
      user && !decorated?.isAdmin
        ? (options.strict
          ? (db as any).libraryItem.findMany({ where: { type: "folder", status: { notIn: ["archived", "trashed"] } }, select: { id: true, parentId: true } })
          : (db as any).libraryItem.findMany({ where: { type: "folder", status: { notIn: ["archived", "trashed"] } }, select: { id: true, parentId: true } }).catch(() => []))
        : Promise.resolve([]),
    ]);
    const folderParents = new Map<string, string | null>((folderRows as any[]).map((folder) => [String(folder.id), folder.parentId ? String(folder.parentId) : null]));
    return { user, decorated, rules, folderPermissions, folderParents };
  }

  async function accessContext(request: FastifyRequest): Promise<LibraryAccessContext> {
    let pending = contextCache.get(request);
    if (!pending) {
      pending = getCurrentUser(request).then((user) => contextForUser(user));
      contextCache.set(request, pending);
    }
    return pending;
  }

  function folderPermissionTrace(context: LibraryAccessContext, item: any) {
    if (!context.user || context.decorated?.isAdmin) return null;
    const directFolderId = item?.type === "folder" ? String(item.id) : item?.parentId ? String(item.parentId) : null;
    let folderId: string | null = directFolderId;
    const visited = new Set<string>();
    while (folderId && !visited.has(folderId)) {
      visited.add(folderId);
      const permission = context.folderPermissions.find((entry: any) => String(entry.folderId) === folderId);
      if (permission) return { permission, sourceFolderId: folderId, inherited: folderId !== directFolderId };
      folderId = context.folderParents.get(folderId) || null;
    }
    return null;
  }

  function folderPermissionFor(context: LibraryAccessContext, item: any) {
    return folderPermissionTrace(context, item)?.permission || null;
  }

  function explainAccess(context: LibraryAccessContext, item: any, minimum: LibraryAccessLevel = "view"): LibraryAccessExplanation {
    if (!context.user || !item) return { allowed: false, required: minimum, effectiveAccess: "none", reasonCode: "AUTH_REQUIRED", contributors: [{ kind: "authentication", detail: "A signed-in Cluster identity is required." }] };
    if (context.decorated?.isAdmin) return { allowed: true, required: minimum, effectiveAccess: "manage", reasonCode: "ADMIN_OVERRIDE", contributors: [{ kind: "workspace-admin", id: context.user.id, access: "manage", detail: "Workspace administration grants Library management access." }] };
    if (["data-export", "data-export-root"].includes(String(item.source || ""))) {
      const allowed = item.ownerId === context.user.id;
      return { allowed, required: minimum, effectiveAccess: allowed ? "manage" : "none", reasonCode: allowed ? "OWNER" : "DENY", contributors: [{ kind: "private-generated-artifact", id: item.id, access: allowed ? "manage" : "none", detail: allowed ? "Private generated artifacts are available only to their owner." : "This generated artifact belongs to another user." }] };
    }
    if (item.ownerId === context.user.id) return { allowed: true, required: minimum, effectiveAccess: "manage", reasonCode: "OWNER", contributors: [{ kind: "owner", id: context.user.id, access: "manage", detail: "Library ownership grants management access unless a stronger Records policy applies." }] };
    const trace = folderPermissionTrace(context, item);
    if (trace) {
      const rank = FOLDER_ACCESS_RANK[String(trace.permission.access)] ?? FOLDER_ACCESS_RANK.none;
      const required = FOLDER_ACCESS_RANK[minimum] ?? FOLDER_ACCESS_RANK.view;
      const effectiveAccess = ACCESS_BY_RANK[Math.max(0, Math.min(ACCESS_BY_RANK.length - 1, rank))];
      return {
        allowed: rank >= required,
        required: minimum,
        effectiveAccess,
        reasonCode: "FOLDER_GRANT",
        contributors: [{ kind: "folder-grant", id: trace.sourceFolderId, access: String(trace.permission.access), inherited: trace.inherited, detail: trace.inherited ? "Access is inherited from an ancestor folder grant." : "Access is granted on the containing folder." }],
      };
    }
    const levels: LibraryAccessLevel[] = ["manage", "edit", "contribute", "view"];
    const effective = levels.find((level) => hasTargetAccess(context.user, context.decorated?.workspaceRole, "library", item.id, item.project || null, context.rules, level)) || "none";
    const allowed = effective !== "none" && (FOLDER_ACCESS_RANK[effective] ?? 0) >= (FOLDER_ACCESS_RANK[minimum] ?? 1);
    return {
      allowed,
      required: minimum,
      effectiveAccess: effective,
      reasonCode: allowed ? "TARGET_POLICY" : "DENY",
      contributors: [{ kind: "authorization-policy", id: item.id, access: effective, detail: allowed ? "Project, role, team, or explicit access policy grants this level." : "No active ownership, folder, project, role, team, or explicit grant satisfies the requested level." }],
    };
  }

  function visibleFor(context: LibraryAccessContext, item: any, minimum: LibraryAccessLevel = "view") {
    return explainAccess(context, item, minimum).allowed;
  }

  async function canAccessItem(request: FastifyRequest, item: any, minimum: LibraryAccessLevel = "view") {
    return visibleFor(await accessContext(request), item, minimum);
  }

  async function filterItems(request: FastifyRequest, items: any[], minimum: LibraryAccessLevel = "view") {
    const context = await accessContext(request);
    return items.filter((item) => visibleFor(context, item, minimum));
  }

  async function loadItem(request: FastifyRequest, itemId: string) {
    let requestItems = itemCache.get(request);
    if (!requestItems) {
      requestItems = new Map();
      itemCache.set(request, requestItems);
    }
    const existing = requestItems.get(itemId);
    if (existing) return existing;
    const lookup: Promise<any | null> = Promise.resolve(prisma.libraryItem.findUnique({
      where: { id: itemId },
      include: { project: { include: { memberships: { where: { status: "active" } } } } },
    })).catch(() => null);
    requestItems.set(itemId, lookup);
    return lookup;
  }

  async function canAccessItemId(
    request: FastifyRequest,
    itemId: string,
    minimum: LibraryAccessLevel = "view",
    scope?: { projectId?: string | null; includeGlobal?: boolean },
  ) {
    const item = await loadItem(request, itemId);
    if (!item) return false;
    if (scope?.projectId && item.projectId !== scope.projectId && !(scope.includeGlobal && item.projectId == null)) return false;
    return canAccessItem(request, item, minimum);
  }

  return {
    accessContext,
    contextForUser,
    folderPermissionFor,
    folderPermissionTrace,
    explainAccess,
    visibleFor,
    canAccessItem,
    canAccessItemId,
    filterItems,
    folderAccessRank: FOLDER_ACCESS_RANK,
  };
}

export type LibraryAccessService = ReturnType<typeof createLibraryAccessService>;
