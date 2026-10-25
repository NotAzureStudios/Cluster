import type { ClusterResourceChange, ClusterResourceKind } from "@cluster/shared";
import { studioAudienceMatchesContext, type StudioAudienceUserContext } from "../access/studio-audience.js";

/**
 * TD4: enrolled providers are the authority for these resource-change kinds.
 * A resource-change envelope is only an invalidation hint, never evidence that
 * the claimed ID/project relationship or access grant is genuine.
 *
 * Providers intentionally load only identity/visibility fields. Registration
 * rejects duplicates rather than allowing one domain to silently override
 * another's authorization contract.
 */
export type ResourceChangeProviderContext = {
  prisma: any;
  authorization: any;
  user: any;
  role: string | null;
  rules: any[];
  projects: Map<string, any>;
  audienceContext?: StudioAudienceUserContext;
  libraryContext?: any;
  libraryVisibleFor?: (context: any, item: any, minimum?: "view") => boolean;
};

type ResourceChangeProvider = {
  kind: ClusterResourceKind;
  load: (prisma: any, ids: string[]) => Promise<Array<Record<string, any>>>;
  visible: (ctx: ResourceChangeProviderContext, row: any, change: ClusterResourceChange) => boolean;
  requiresAudience?: boolean;
  requiresLibrary?: boolean;
};

const providers = new Map<ClusterResourceKind, ResourceChangeProvider>();

function enroll(provider: ResourceChangeProvider) {
  if (providers.has(provider.kind)) throw new Error(`Duplicate resource change provider: ${provider.kind}`);
  providers.set(provider.kind, provider);
}

function canReadProjectTarget(ctx: ResourceChangeProviderContext, kind: string, id: string, projectId: unknown) {
  if (typeof projectId !== "string" || !projectId) return false;
  const project = ctx.projects.get(projectId);
  return Boolean(project && ctx.authorization.hasTargetAccess(ctx.user, ctx.role, kind, id, project, ctx.rules, "view"));
}

// A Project change is not automatically safe just because the actor is an
// administrator. The object can already be archived or removed, and callers
// must never receive a fabricated Project identifier from the event stream.
enroll({
  kind: "project",
  load: (prisma, ids) => prisma.project.findMany({
    where: { id: { in: ids }, archived: false },
    select: { id: true },
  }),
  visible: (ctx, row) => canReadProjectTarget(ctx, "project", row.id, row.id),
});

enroll({
  kind: "board",
  load: (prisma, ids) => prisma.board.findMany({ where: { id: { in: ids }, archived: false }, select: { id: true, projectId: true } }),
  visible: (ctx, row) => ctx.authorization.hasToolPermission(ctx.user, ctx.role, "boards", "view")
    && canReadProjectTarget(ctx, "board", row.id, row.projectId),
});

enroll({
  kind: "whiteboard",
  load: (prisma, ids) => prisma.whiteboard.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true } }),
  visible: (ctx, row) => row.projectId
    ? canReadProjectTarget(ctx, "whiteboard", row.id, row.projectId)
    : ctx.authorization.hasToolPermission(ctx.user, ctx.role, "whiteboards", "view"),
});

enroll({
  kind: "timeline",
  load: (prisma, ids) => prisma.timelineItem.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true, userId: true } }),
  visible: (ctx, row) => row.projectId
    ? canReadProjectTarget(ctx, "timeline", row.id, row.projectId)
    : ctx.authorization.hasToolPermission(ctx.user, ctx.role, "timeline", row.userId === ctx.user.id ? "view" : "manage"),
});

/**
 * Delivery records live under one Project's delivery API. Its read endpoint
 * authorizes the Project, then proves the record belongs to it and is active.
 * Enroll the same four canonical storage models here; a resource-change
 * envelope must never become a shortcut around record existence/archival.
 */
const deliveryResourceKinds = [
  { kind: "build", model: "deliveryBuild" },
  { kind: "qa_plan", model: "deliveryQaPlan" },
  { kind: "qa_session", model: "deliveryQaSession" },
  { kind: "release", model: "deliveryRelease" },
] as const;

for (const definition of deliveryResourceKinds) {
  enroll({
    kind: definition.kind,
    load: (prisma, ids) => prisma[definition.model].findMany({
      where: { id: { in: ids }, archived: false },
      select: { id: true, projectId: true },
    }),
    // The canonical delivery read routes gate on Project view authority.
    // Individual IDs must still be checked against the Project's target rules.
    visible: (ctx, row) => canReadProjectTarget(ctx, "project", row.projectId, row.projectId),
  });
}

/**
 * Studio-system invalidations carry IDs only, but those IDs still disclose
 * private participation and application state. These providers share the
 * canonical Form/Packet read-side rules, never generic target membership.
 */
function studioAdmin(ctx: ResourceChangeProviderContext) {
  return ctx.authorization.hasToolPermission(ctx.user, ctx.role, "settings", "edit");
}
function audienceAllows(ctx: ResourceChangeProviderContext, audienceJson: unknown) {
  if (!ctx.audienceContext) return false;
  // The general Studio UI deliberately tolerates legacy/malformed audience
  // JSON. An invalid stream audience must *not* fall back to "all".
  let audience: unknown;
  try { audience = typeof audienceJson === "string" ? JSON.parse(audienceJson) : audienceJson; }
  catch { return false; }
  if (!audience || typeof audience !== "object" || Array.isArray(audience)) return false;
  const record = audience as Record<string, unknown>;
  if (record.mode !== "all" && (!Array.isArray(record.targets) || !record.targets.length)) return false;
  return studioAudienceMatchesContext(audience, String(ctx.user.id), ctx.audienceContext);
}

enroll({
  kind: "studio_form",
  requiresAudience: true,
  load: (prisma, ids) => prisma.studioForm.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, status: true, purpose: true, audienceJson: true,
      versions: { where: { status: "published" }, take: 1, select: { id: true } },
    },
  }),
  visible: (ctx, row) => studioAdmin(ctx) || (row.status === "active"
    && row.purpose !== "application" && row.versions?.length > 0
    && audienceAllows(ctx, row.audienceJson)),
});

enroll({
  kind: "form_submission",
  requiresAudience: true,
  load: (prisma, ids) => prisma.studioFormSubmission.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, userId: true, formId: true,
      form: { select: { status: true, purpose: true, audienceJson: true,
        versions: { where: { status: "published" }, take: 1, select: { id: true } } } },
    },
  }),
  // An application from a public respondent has no authenticated owner.
  // Studio users see only their own current-audience submissions; reviewing
  // another respondent's answers requires Studio Systems admin authority.
  visible: (ctx, row) => studioAdmin(ctx) || (row.userId === ctx.user.id
    && row.form?.status === "active" && row.form?.purpose !== "application"
    && row.form?.versions?.length > 0 && audienceAllows(ctx, row.form.audienceJson)),
});

// Public applicant identity is never audience-readable. Only the authorized
// Studio Systems reviewer can receive an application invalidation.
enroll({
  kind: "application",
  load: (prisma, ids) => prisma.studioFormSubmission.findMany({
    where: { id: { in: ids }, form: { purpose: "application" } },
    select: { id: true },
  }),
  visible: (ctx) => studioAdmin(ctx),
});

enroll({
  kind: "packet",
  requiresAudience: true,
  requiresLibrary: true,
  load: async (prisma, ids) => {
    const definitions = await prisma.packetDefinition.findMany({
      where: { libraryFolderId: { in: ids } },
      select: { libraryFolderId: true, audienceJson: true,
        libraryFolder: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } },
    });
    return definitions.map((definition: any) => ({
      id: definition.libraryFolderId,
      audienceJson: definition.audienceJson,
      libraryFolder: definition.libraryFolder,
    }));
  },
  visible: (ctx, row) => Boolean(row.libraryFolder?.type === "folder"
    && !["archived", "trashed", "destroyed"].includes(String(row.libraryFolder?.status))
    && ctx.authorization.hasToolPermission(ctx.user, ctx.role, "packets", "view")
    && ctx.libraryContext && ctx.libraryVisibleFor?.(ctx.libraryContext, row.libraryFolder, "view")
    && (studioAdmin(ctx) || audienceAllows(ctx, row.audienceJson))),
});

/**
 * People invalidations disclose IDs rather than profile fields, but still
 * require the actual normalized People identity and the current directory
 * permission. Private Personnel Records have their own independent service;
 * nothing here grants access to legal names, contact details or records.
 * Archived organizational entries are visible only to People managers so
 * their directory can reconcile a removal without leaking old identities.
 */
function canReadPeopleDirectory(ctx: ResourceChangeProviderContext, archived: boolean) {
  return ctx.authorization.hasToolPermission(ctx.user, ctx.role, "people", archived ? "manage" : "view");
}

enroll({
  kind: "user",
  load: (prisma, ids) => prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, archived: true, accountState: true },
  }),
  visible: (ctx, row) => row.accountState !== "PRIVACY_ERASED"
    && (canReadPeopleDirectory(ctx, Boolean(row.archived))
      || (row.id === ctx.user.id && !row.archived)),
});

const peopleOrganizationKinds = [
  { kind: "team", model: "studioTeam" },
  { kind: "department", model: "department" },
  { kind: "job_role", model: "jobRole" },
] as const;
for (const definition of peopleOrganizationKinds) {
  enroll({
    kind: definition.kind,
    load: (prisma, ids) => prisma[definition.model].findMany({
      where: { id: { in: ids } }, select: { id: true, archived: true },
    }),
    visible: (ctx, row) => canReadPeopleDirectory(ctx, Boolean(row.archived)),
  });
}

/**
 * Governance broadcasts are not public resource identities. The outbox may
 * publish an update to every connected client, but each receiver still needs
 * the current audience and an actually published record. A role grant does
 * not allow a draft title/ID to leak through the shared feed.
 */
enroll({
  kind: "announcement",
  requiresAudience: true,
  load: (prisma, ids) => prisma.studioAnnouncement.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, audienceJson: true },
  }),
  visible: (ctx, row) => studioAdmin(ctx)
    || (row.status === "published" && audienceAllows(ctx, row.audienceJson)),
});

enroll({
  kind: "policy",
  requiresAudience: true,
  load: (prisma, ids) => prisma.studioPolicy.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, audienceJson: true,
      versions: { where: { status: "published" }, take: 1, select: { id: true } } },
  }),
  visible: (ctx, row) => studioAdmin(ctx)
    || (row.status === "active" && row.versions?.length > 0
      && audienceAllows(ctx, row.audienceJson)),
});

/**
 * Assignment IDs are personal workflow state. They must never be admitted by
 * a generic People/Studio permission. Keep delivery to the assigned member
 * (or a Studio Systems reviewer) even after revocation so the member can
 * invalidate a previously visible assignment and refresh their task list.
 * A draft plan/version is not a member-visible assignment.
 */
enroll({
  kind: "onboarding_assignment",
  load: (prisma, ids) => prisma.studioOnboardingAssignment.findMany({
    where: { id: { in: ids } },
    select: { id: true, userId: true,
      planVersion: { select: { status: true, plan: { select: { status: true } } } } },
  }),
  visible: (ctx, row) => studioAdmin(ctx)
    || (row.userId === ctx.user.id && row.planVersion?.status === "published"
      && row.planVersion?.plan?.status === "active"),
});

/**
 * Source repositories and commits can belong to more than one Project.
 * Permission to see one linked Project does not authorize invalidations
 * explicitly scoped to another Project. Only live bindings count.
 */
function sourceBindingProjects(row: any): string[] {
  return [...new Set((row.repository?.projects ?? row.projects ?? [])
    .filter((binding: any) => !binding.archived && typeof binding.projectId === "string" && binding.projectId)
    .map((binding: any) => String(binding.projectId)))];
}

function visibleSourceBinding(ctx: ResourceChangeProviderContext, row: any, change: ClusterResourceChange) {
  if (!ctx.authorization.hasToolPermission(ctx.user, ctx.role, "sourceControl", "view")) return false;
  const boundProjects = sourceBindingProjects(row);
  const requestedProject = change.resource.projectId;
  // The review API is Project-scoped, and its review must still have an active
  // binding to its canonical repository for that exact Project.
  if (change.resource.kind === "source_review") {
    if (typeof row.projectId !== "string" || !boundProjects.includes(row.projectId)) return false;
    if (requestedProject && requestedProject !== row.projectId) return false;
    return canReadProjectTarget(ctx, "project", row.projectId, row.projectId);
  }
  if (requestedProject) {
    return boundProjects.includes(requestedProject)
      && canReadProjectTarget(ctx, "project", requestedProject, requestedProject);
  }
  // A repository may be in several Projects; one accessible binding suffices
  // for an unscoped invalidation but never for another Project's scoped event.
  return boundProjects.some((projectId) => canReadProjectTarget(ctx, "project", projectId, projectId));
}

// These adapters deliberately do not authorize unbound repositories through
// the generic administrator shortcut: the public feed has no corresponding
// Project resource to invalidate until the repository is linked.
enroll({
  kind: "source_repository",
  load: (prisma, ids) => prisma.sourceRepository.findMany({
    where: { id: { in: ids }, archived: false },
    select: { id: true, projects: { where: { archived: false }, select: { projectId: true } } },
  }),
  visible: visibleSourceBinding,
});

enroll({
  kind: "source_commit",
  load: (prisma, ids) => prisma.sourceCommit.findMany({
    where: { id: { in: ids }, repository: { archived: false } },
    select: { id: true, repository: { select: { projects: { where: { archived: false }, select: { projectId: true } } } } },
  }),
  visible: visibleSourceBinding,
});

enroll({
  kind: "source_review",
  load: (prisma, ids) => prisma.sourceReview.findMany({
    where: { id: { in: ids }, repository: { archived: false } },
    select: { id: true, projectId: true, repository: {
      select: { projects: { where: { archived: false }, select: { projectId: true } } },
    } },
  }),
  visible: visibleSourceBinding,
});

export function isEnrolledResourceChangeProvider(kind: ClusterResourceKind) {
  return providers.has(kind);
}

/**
 * Batch-resolve canonical identities *before* gathering Project permissions.
 * Some outbox producers omit projectId on an otherwise valid resource. The
 * provider row is authoritative; never accept the envelope as a grant or
 * silently drop a real change solely because its optional scope was omitted.
 * The same snapshot is reused for the final decision: no second provider read
 * can return a different resource/project between rule loading and delivery.
 */
export async function loadResourceChangeProviderSnapshot(
  prisma: any,
  changes: readonly ClusterResourceChange[],
) {
  const loaded = new Map<ClusterResourceKind, {
    provider: ResourceChangeProvider;
    byId: Map<string, Record<string, any>>;
  }>();
  const projectIds = new Set<string>();
  let requiresAudience = false;
  let requiresLibrary = false;
  for (const [kind, provider] of providers) {
    const requested = changes.filter((change) => change.resource.kind === kind);
    if (!requested.length) continue;
    requiresAudience ||= provider.requiresAudience === true;
    requiresLibrary ||= provider.requiresLibrary === true;
    const ids = [...new Set(requested.map((change) => change.resource.id))];
    const rows = await provider.load(prisma, ids);
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    loaded.set(kind, { provider, byId });
    for (const row of rows) {
      const projectId = kind === "project" ? row.id : row.projectId;
      if (typeof projectId === "string" && projectId) projectIds.add(projectId);
      // Source repositories and commits may have multiple active bindings.
      // Resolve access rules for *every* linked Project before visibility.
      if (kind === "source_repository" || kind === "source_commit" || kind === "source_review") {
        for (const linkedId of sourceBindingProjects(row)) projectIds.add(linkedId);
      }
    }
  }
  return {
    projectIds: [...projectIds],
    requiresAudience,
    requiresLibrary,
    visible(ctx: ResourceChangeProviderContext) {
      const allowed = new Set<ClusterResourceChange>();
      for (const change of changes) {
        const record = loaded.get(change.resource.kind);
        if (!record) continue;
        const row = record.byId.get(change.resource.id);
        if (!row) continue;
        const authoritativeProjectId = change.resource.kind === "project" ? row.id : row.projectId;
        // A supplied but false project scope is never accepted, including a
        // forged scope on a standalone resource.
        if (change.resource.projectId && change.resource.projectId !== authoritativeProjectId
          && change.resource.kind !== "source_repository" && change.resource.kind !== "source_commit") continue;
        if (record.provider.visible(ctx, row, change)) allowed.add(change);
      }
      return allowed;
    },
  };
}
