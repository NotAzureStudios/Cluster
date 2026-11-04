import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { PEOPLE_DATA_FIELDS, userDirectoryPageQuerySchema } from "@cluster/shared";
import { buildCursorPage, cursorWhere, decodeCursor } from "../../core/cursor-pagination.js";
import { normalizeClusterDataQuery } from "../../core/data-query.js";
import { parseClusterDataQueryParameter } from "../../core/data-query-http.js";
import { decodePeopleCursor, encodePeopleCursor, filterPeopleDataRows, peopleDataQueryAnalytics, sortPeopleDataRows } from "./people-data-query.js";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import { expertiseSchema, normalizeExpertise, parseJsonRecord as parseProfileJsonRecord, profileFieldDefinitionsSchema, validateCustomProfileFields, workingHoursSchema } from "./people-profile-contract.js";
import { PeopleGovernanceError, lockPeopleProfile, validateManagerAssignment } from "./people-governance.js";
import { assignableStudioRoles, assignWorkspaceRole, requireAssignableStudioRole } from "./people-role-governance.js";
import { applyDisclosureObligations, userDisclosureObligations } from "../access/disclosure.js";
import { syncUserWorkforceAuthorities } from "../workforce/workforce-normalization.js";
import { WORKFORCE_USER_AUTHORITY_INCLUDE } from "../workforce/workforce-user-authority.js";
import { validateReturnAccessWindow } from "../studio-systems/studio-return-eligibility.js";
import { validPeopleStartDate, validPeopleTimeZone } from "./people-input-validation.js";

type UserDirectoryRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  getWorkspaceRole: (userId: string) => Promise<string | null | undefined>;
  hasToolPermission: (...args: any[]) => boolean;
  serializeUserLite: (user: any) => any;
  serializeUserPrivate: (user: any) => any;
  serializeUserPublicProfile: (user: any) => any;
  parseObject: (value: string | null | undefined) => Record<string, string>;
  normalizeAuthUsername: (value: string) => string;
  hashPassword: (value: string) => Promise<string>;
  generateTemporaryPassword: (length?: number) => string;
  logSecurityEvent: (...args: any[]) => Promise<unknown>;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  canViewPrivateUserProfile: (...args: any[]) => boolean | Promise<boolean>;
  serializeActivityEvent: (event: any) => any;
  readSettings: () => Promise<any>;
  authorization: any;
};

export function registerUserDirectoryRoutes(deps: UserDirectoryRouteDependencies) {
  const { app, prisma, getCurrentUser, getWorkspaceRole, hasToolPermission, serializeUserLite, serializeUserPrivate, serializeUserPublicProfile, parseObject, normalizeAuthUsername, hashPassword, generateTemporaryPassword, logSecurityEvent, logActivity, canViewPrivateUserProfile, serializeActivityEvent, readSettings, authorization } = deps;
app.get("/api/admin/users/assignable-roles", async (request, reply) => {
  const actor = await getCurrentUser(request);
  if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: actor.id }, orderBy: { workspaceId: "asc" },
    select: { workspaceId: true, role: true },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return reply.code(403).send({ ok: false, code: "ROLE_ADMIN_REQUIRED" });
  }
  const definitions = assignableStudioRoles(await readSettings());
  const counts = await prisma.workspaceMember.groupBy({
    by: ["role"], where: { workspaceId: membership.workspaceId }, _count: { _all: true },
  });
  const countByRole = new Map<string, number>(counts.map((row: any) => [String(row.role), Number(row._count?._all || 0)]));
  return {
    workspaceId: membership.workspaceId,
    actorRole: membership.role,
    roles: definitions.map((role) => ({ ...role, members: countByRole.get(role.id) || 0 })),
  };
});
app.get("/api/users", async (request, reply) => {
  const viewer = await getCurrentUser(request);
  if (!viewer) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
  const viewerMembership = await prisma.workspaceMember.findFirst({
    where: { userId: viewer.id }, select: { workspaceId: true }, orderBy: { workspaceId: "asc" },
  });
  if (!viewerMembership) return reply.code(403).send({ ok: false, code: "WORKSPACE_ACCESS_DENIED" });
  const workspaceId = viewerMembership.workspaceId;
  const viewerRole = viewer ? await getWorkspaceRole(viewer.id) : null;
  const privateDecision = viewer ? await authorization.authorize(request, "manage", { kind: "tool", tool: "people" }, { minimum: "manage", surface: "api" }) : null;
  const includePrivate = Boolean(privateDecision?.allowed);
  const disclosure = userDisclosureObligations({ includePrivate, includeSecurityState: includePrivate, surface: "api" });
  const includeRawSummary = Boolean(viewer && ["owner", "admin"].includes(String(viewerRole || "")));
  const query = userDirectoryPageQuerySchema.parse(request.query || {});
  if (query.includeArchived && !includePrivate) return reply.code(403).send({ ok: false, code: "PEOPLE_ARCHIVED_DENIED" });
  if (query.summary) {
    const requestedDataQuery = parseClusterDataQueryParameter(query.dataQuery);
    const dataQuery = normalizeClusterDataQuery({ ...requestedDataQuery, page: { cursor: query.cursor || null, limit: query.limit } }, { fields: PEOPLE_DATA_FIELDS, defaultLimit: query.limit, maxLimit: 1000 });
    const offset = decodePeopleCursor(query.cursor, dataQuery);
    if (offset == null) throw Object.assign(new Error("People cursor does not match the active query."), { code: "DATA_CURSOR_INVALID", statusCode: 400 });
    const users = await prisma.user.findMany({
      where: {
        archived: query.includeArchived ? undefined : false,
        memberships: { some: { workspaceId, ...(query.role ? { role: query.role } : {}) } },
      },
      include: { memberships: true, ...WORKFORCE_USER_AUTHORITY_INCLUDE },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 5000,
    });
    const projected = users.map((user: any) => ({
      ...serializeUserLite(user),
      workspaceRole: user.memberships.find((membership: any) => membership.workspaceId === workspaceId)?.role || "member",
      updatedAt: user.updatedAt,
      ...(includePrivate ? { accountState: user.accountState, accountType: user.accountType, accessExpiresAt: user.accessExpiresAt } : {}),
    }));
    const filtered = filterPeopleDataRows(projected, dataQuery, { department: query.department || null });
    const sorted = sortPeopleDataRows(filtered, dataQuery);
    const items = sorted.slice(offset, offset + query.limit);
    const nextOffset = offset + items.length;
    const hasMore = nextOffset < sorted.length;
    const nextCursor = hasMore ? encodePeopleCursor(nextOffset, dataQuery) : null;
    if (!query.paged && !query.cursor) {
      if (nextCursor) reply.header("X-Next-Cursor", nextCursor);
      return items;
    }
    const analytics = query.cursor ? null : peopleDataQueryAnalytics(filtered, dataQuery);
    return {
      items,
      nextCursor,
      hasMore,
      dataView: {
        resourceKind: "user",
        fields: PEOPLE_DATA_FIELDS,
        query: dataQuery,
        analytics,
        page: { nextCursor, hasMore, cursorSupported: true },
        continuationSort: dataQuery.sorts?.length ? dataQuery.sorts : [{ fieldId: "updatedAt", direction: "desc" }],
        semanticSortApplied: true,
      },
    };
  }
  const cursor = decodeCursor(query.cursor);
  const users = await prisma.user.findMany({
    where: {
      archived: query.includeArchived ? undefined : false,
      employment: query.department ? { is: { department: { is: { name: query.department } } } } : undefined,
      memberships: { some: { workspaceId, ...(query.role ? { role: query.role } : {}) } },
      ...(cursorWhere(cursor, "updatedAt", "desc") || {}),
    },
    include: {
      memberships: true,
      ...WORKFORCE_USER_AUTHORITY_INCLUDE,
      ...(includeRawSummary ? {
        _count: { select: { assignedCards: true, comments: true, activityEvents: true } },
        activityEvents: { orderBy: { createdAt: "desc" }, take: 1 },
      } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  });
  const page = buildCursorPage(users, query.limit, "updatedAt");
  const items = page.items.map((user: any) => applyDisclosureObligations({
    ...(includePrivate ? serializeUserPrivate(user) : serializeUserPublicProfile(user)),
    workspaceRole: user.memberships.find((membership: any) => membership.workspaceId === workspaceId)?.role || "member",
    isAdmin: ["owner", "admin"].includes(user.memberships.find((membership: any) => membership.workspaceId === workspaceId)?.role || "member"),
    privateProfile: includePrivate,
    sensitiveProfileHidden: !includePrivate,
    toolPermissions: includePrivate ? parseObject(user.toolPermissions) : {},
    projectPermissions: includePrivate ? parseObject(user.projectPermissions) : {},
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    ...(includeRawSummary ? { lastActivityAt: user.activityEvents?.[0]?.createdAt ?? null, counts: user._count } : {}),
  }, disclosure));
  if (!query.paged && !query.cursor) {
    if (page.nextCursor) reply.header("X-Next-Cursor", page.nextCursor);
    return items;
  }
  return { items, nextCursor: page.nextCursor, hasMore: page.hasMore };
});
app.post("/api/users", async (request, reply) => {
  const actor = await getCurrentUser(request);
  if (!actor) return reply.code(401).send({ ok: false, error: "Login required." });
  const actorMembership = await prisma.workspaceMember.findFirst({
    where: { userId: actor.id }, orderBy: { workspaceId: "asc" },
    select: { workspaceId: true, role: true },
  });
  if (!actorMembership || !["owner", "admin"].includes(actorMembership.role)) {
    return reply.code(403).send({ ok: false, code: "ROLE_ADMIN_REQUIRED" });
  }
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: actorMembership.workspaceId } });
  const body = z
    .object({
      username: z.string().min(3).max(32),
      employeeNumber: z.string().trim().max(80).optional().nullable(),
      displayName: z.string().optional().nullable(),
      email: z.string().email().optional().nullable(),
      avatarUrl: z.string().url().optional().nullable(),
      title: z.string().optional().nullable(),
      department: z.string().optional().nullable(),
      legalName: z.string().max(160).optional().nullable(),
      preferredName: z.string().optional().nullable(),
      pronouns: z.string().max(160).optional().nullable(),
      phoneNumber: z.string().max(60).optional().nullable(),
      alternatePhoneNumber: z.string().optional().nullable(),
      alternateEmails: z.array(z.string()).optional().default([]),
      addressLine1: z.string().optional().nullable(),
      addressLine2: z.string().optional().nullable(),
      city: z.string().optional().nullable(),
      stateProvince: z.string().optional().nullable(),
      postalCode: z.string().optional().nullable(),
      country: z.string().optional().nullable(),
      emergencyContactName: z.string().optional().nullable(),
      emergencyContactPhone: z.string().optional().nullable(),
      emergencyContactRelation: z.string().optional().nullable(),
      employmentType: z.string().optional().nullable(),
      accountType: z.enum(["employee", "contractor", "client", "guest"]).optional(),
      accessExpiresAt: z.string().optional().nullable(),
      invitedById: z.string().optional().nullable(),
      workLocation: z.string().optional().nullable(),
      hideLegalName: z.boolean().optional(),
      hideLocation: z.boolean().optional(),
      timezone: z.string().max(100).refine(validPeopleTimeZone, "Choose a valid IANA time zone.").optional().nullable(),
      skills: z.array(z.string()).optional().default([]),
      expertise: expertiseSchema.optional().default([]),
      workingHours: workingHoursSchema.optional().default({}),
      customProfileFields: z.record(z.unknown()).optional().default({}),
      managerUserId: z.string().optional().nullable(),
      capacityHours: z.coerce.number().int().min(0).max(168).optional().nullable(),
      minimumHours: z.coerce.number().int().min(0).max(168).optional().nullable(),
      notes: z.string().max(4000).optional().nullable(),
      startDate: z.string().max(64).refine(validPeopleStartDate, "Choose a valid employment date.").optional().nullable(),
      role: z.string().trim().min(1).max(80).default("member"),
      toolPermissions: z.record(z.string()).optional(),
      projectPermissions: z.record(z.string()).optional(),
    })
    .parse(request.body);
  try {
    const role = requireAssignableStudioRole(await readSettings(), body.role);
    if (role.privileged && actorMembership.role !== "owner") {
      return reply.code(403).send({ ok: false, code: "ROLE_OWNER_REQUIRED", error: "Only a workspace owner can assign owner/admin roles." });
    }
  } catch (error) {
    if (error instanceof PeopleGovernanceError) return reply.code(error.statusCode).send({ ok: false, code: error.code, error: error.message });
    throw error;
  }
  if (body.minimumHours != null && body.capacityHours != null && body.minimumHours > body.capacityHours) {
    return reply.code(400).send({
      ok: false,
      error: "Minimum hours cannot exceed capacity hours.",
    });
  }
  let username = "";
  try {
    username = normalizeAuthUsername(body.username);
  } catch (error) {
    return reply.code(400).send({
      ok: false,
      error: error instanceof Error ? error.message : "Invalid username.",
    });
  }
  const existing = await (prisma as any).user.findUnique({
    where: { username },
    include: {
      memberships: true,
      _count: {
        select: { assignedCards: true, comments: true, activityEvents: true },
      },
    },
  });
  const managerRecord = body.managerUserId ? await prisma.user.findFirst({ where: { id: body.managerUserId, archived: false, memberships: { some: { workspaceId: workspace.id } } }, select: { id: true, displayName: true, preferredName: true, username: true } }) : null;
  if (body.managerUserId && !managerRecord) return reply.code(400).send({ ok: false, error: "Choose an active manager." });
  if (body.managerUserId === actor.id && body.username === actor.username) return reply.code(400).send({ ok: false, error: "A person cannot manage themselves." });
  if (body.projectPermissions && Object.keys(body.projectPermissions).length)
    return reply.code(409).send({ ok: false, code: "SCOPED_GRANT_REVIEW_REQUIRED", error: "Initial Project grants require independent approval after identity provisioning." });
  // Expiring accounts cannot be provisioned without a valid finite access window.
  validateReturnAccessWindow(body.accountType || "employee", body.accessExpiresAt ? new Date(body.accessExpiresAt) : null);
  const commonData = {
    employeeNumber: body.employeeNumber?.trim() || null,
    displayName: body.displayName?.trim() || null,
    email: body.email?.trim() || null,
    avatarUrl: body.avatarUrl || null,
    legalName: body.legalName ?? null,
    preferredName: body.preferredName ?? null,
    pronouns: body.pronouns ?? null,
    phoneNumber: body.phoneNumber ?? null,
    alternatePhoneNumber: body.alternatePhoneNumber ?? null,
    alternateEmails: JSON.stringify(body.alternateEmails || []),
    addressLine1: body.addressLine1 ?? null,
    addressLine2: body.addressLine2 ?? null,
    city: body.city ?? null,
    stateProvince: body.stateProvince ?? null,
    postalCode: body.postalCode ?? null,
    country: body.country ?? null,
    emergencyContactName: body.emergencyContactName ?? null,
    emergencyContactPhone: body.emergencyContactPhone ?? null,
    emergencyContactRelation: body.emergencyContactRelation ?? null,
    accountType: body.accountType || "employee",
    accessExpiresAt: body.accessExpiresAt ? new Date(body.accessExpiresAt) : null,
    invitedById: body.invitedById || actor.id,
    hideLegalName: body.hideLegalName ?? true,
    hideLocation: body.hideLocation ?? false,
    customProfileFields: JSON.stringify(validateCustomProfileFields(body.customProfileFields, profileFieldDefinitionsSchema.parse((await readSettings()).studioPeopleProfileFields || []), true, false)),
    notes: body.notes ?? null,
    toolPermissions: JSON.stringify(body.toolPermissions || {}),
    projectPermissions: JSON.stringify(body.projectPermissions || {}),
  };
  if (existing) {
    return reply.code(409).send({
      ok: false,
      error: "That username is already assigned to an account.",
    });
  }
  const temporaryPassword = generateTemporaryPassword();
  const temporaryPasswordHash = await hashPassword(temporaryPassword);
  // Provision identity, workspace membership and normalized workforce records
  // atomically. A failed department/manager/skills write must not leave an
  // orphaned, login-capable account with partially applied studio access.
  const canonicalSaved: any = await prisma.$transaction(async (tx: any) => {
    const created = await tx.user.create({
      data: {
        username,
        ...commonData,
        passwordHash: temporaryPasswordHash,
        passwordChangedAt: null,
        accountState: "PASSWORD_CHANGE_REQUIRED",
        failedLoginCount: 0,
        lockedUntil: null,
        memberships: { create: { workspaceId: workspace.id, role: body.role } },
      },
    });
    await syncUserWorkforceAuthorities(tx, { workspaceId: workspace.id, userId: created.id, input: { ...body, expertise: normalizeExpertise(body.expertise) }, create: true });
    return tx.user.findUniqueOrThrow({
      where: { id: created.id },
      include: { memberships: true, ...WORKFORCE_USER_AUTHORITY_INCLUDE, _count: { select: { assignedCards: true, comments: true, activityEvents: true } } },
    });
  });
  const saved = canonicalSaved;
  await logSecurityEvent({
    event: "account.created",
    actorUserId: actor.id,
    targetUserId: saved.id,
    workspaceId: workspace.id,
    result: "SUCCESS",
    reasonCode: "ADMIN_PROVISIONED",
    request,
    metadata: { role: body.role, accountState: "PASSWORD_CHANGE_REQUIRED" },
  });
  await logActivity({
    userId: actor.id,
    type: "created",
    entityType: "user",
    entityId: saved.id,
    title: body.accountType && body.accountType !== "employee" ? "Guest access created" : "User created",
    message: `${saved.displayName || saved.username}${body.accessExpiresAt ? ` · access until ${body.accessExpiresAt}` : ""}`,
  });
  return {
    ...serializeUserPrivate(canonicalSaved),
    workspaceRole: body.role,
    counts: canonicalSaved._count,
    lastActivityAt: null,
    temporaryPassword,
  };
});
app.patch("/api/users/:userId", async (request, reply) => {
  const actor = await getCurrentUser(request);
  const params = z.object({ userId: z.string() }).parse(request.params);
  const body = z
    .object({
      username: z.string().min(1).optional(),
      employeeNumber: z.string().trim().max(80).optional().nullable(),
      displayName: z.string().optional().nullable(),
      email: z.string().email().optional().nullable(),
      avatarUrl: z.string().url().optional().nullable(),
      title: z.string().optional().nullable(),
      department: z.string().optional().nullable(),
      legalName: z.string().max(160).optional().nullable(),
      preferredName: z.string().optional().nullable(),
      pronouns: z.string().max(160).optional().nullable(),
      phoneNumber: z.string().max(60).optional().nullable(),
      alternatePhoneNumber: z.string().optional().nullable(),
      alternateEmails: z.array(z.string()).optional(),
      addressLine1: z.string().optional().nullable(),
      addressLine2: z.string().optional().nullable(),
      city: z.string().optional().nullable(),
      stateProvince: z.string().optional().nullable(),
      postalCode: z.string().optional().nullable(),
      country: z.string().optional().nullable(),
      emergencyContactName: z.string().optional().nullable(),
      emergencyContactPhone: z.string().optional().nullable(),
      emergencyContactRelation: z.string().optional().nullable(),
      employmentType: z.string().optional().nullable(),
      accountType: z.enum(["employee", "contractor", "client", "guest"]).optional(),
      accessExpiresAt: z.string().optional().nullable(),
      invitedById: z.string().optional().nullable(),
      workLocation: z.string().optional().nullable(),
      hideLegalName: z.boolean().optional(),
      hideLocation: z.boolean().optional(),
      timezone: z.string().max(100).refine(validPeopleTimeZone, "Choose a valid IANA time zone.").optional().nullable(),
      skills: z.array(z.string()).optional(),
      expertise: expertiseSchema.optional(),
      workingHours: workingHoursSchema.optional(),
      customProfileFields: z.record(z.unknown()).optional(),
      managerUserId: z.string().optional().nullable(),
      expectedProfileRevision: z.coerce.number().int().min(1).optional(),
      capacityHours: z.coerce.number().int().min(0).max(168).optional().nullable(),
      minimumHours: z.coerce.number().int().min(0).max(168).optional().nullable(),
      notes: z.string().max(4000).optional().nullable(),
      startDate: z.string().max(64).refine(validPeopleStartDate, "Choose a valid employment date.").optional().nullable(),
      archived: z.boolean().optional(),
      role: z.string().trim().min(1).max(80).optional(),
      toolPermissions: z.record(z.string()).optional(),
      projectPermissions: z.record(z.string()).optional(),
    })
    .parse(request.body);
  if (!actor) {
    return reply.code(401).send({ ok: false, error: "Login required." });
  }
  const actorMembership = await prisma.workspaceMember.findFirst({
    where: { userId: actor.id }, select: { workspaceId: true }, orderBy: { workspaceId: "asc" },
  });
  if (!actorMembership) return reply.code(403).send({ ok: false, code: "WORKSPACE_ACCESS_DENIED" });
  const existingUser = await prisma.user.findFirst({
    where: { id: params.userId, memberships: { some: { workspaceId: actorMembership.workspaceId } } },
    select: { id: true },
  });
  if (!existingUser) return reply.code(404).send({ ok: false, code: "USER_NOT_FOUND" });
  const profileSettings = await readSettings();
  const profileDefinitions = profileFieldDefinitionsSchema.parse(profileSettings.studioPeopleProfileFields || []);
  let updated: any;
  let roleChange: { changed: boolean; from: string; to: string; workspaceId: string } | null = null;
  try {
    const outcome = await prisma.$transaction(async (tx: any) => {
      await lockPeopleProfile(tx, params.userId);
      let transactionRoleChange: { changed: boolean; from: string; to: string; workspaceId: string } | null = null;
      const fresh = await tx.user.findUnique({ where: { id: params.userId }, include: { employment: true, workingPattern: true } });
      if (!fresh) throw new PeopleGovernanceError("USER_NOT_FOUND", "User not found.", 404);
      const targetMembership = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: actorMembership.workspaceId, userId: params.userId } },
        select: { userId: true },
      });
      if (!targetMembership) throw new PeopleGovernanceError("USER_NOT_IN_WORKSPACE", "This account is not part of your workspace.", 404);
      // Archive is an offboarding lifecycle transition, not an editable profile preference.
      if (body.archived !== undefined || fresh.archived || fresh.accountState === "PRIVACY_ERASED")
        throw new PeopleGovernanceError("PEOPLE_LIFECYCLE_GOVERNED", "Archived people must use the governed return-to-studio workflow. Archiving requires offboarding.", 409);
      if (body.projectPermissions !== undefined) throw new PeopleGovernanceError("SCOPED_GRANT_REVIEW_REQUIRED", "Use the governed Scoped Grants workflow to change individual Project access.", 409);
      if (body.accessExpiresAt !== undefined) throw new PeopleGovernanceError("ACCESS_RENEWAL_GOVERNED", "Access expiration can only be changed through two-person Access Renewal review.", 409);
      if (body.accountType && ["contractor", "client", "guest"].includes(body.accountType)) validateReturnAccessWindow(body.accountType, fresh.accessExpiresAt, new Date());
      if (body.expectedProfileRevision && Number(fresh.profileRevision || 1) !== body.expectedProfileRevision) throw new PeopleGovernanceError("PROFILE_REVISION_CONFLICT", "This profile changed since it was opened.", 409, { currentRevision: Number(fresh.profileRevision || 1) });
      if (body.role) {
        if (!body.expectedProfileRevision) throw new PeopleGovernanceError("ROLE_PROFILE_REVISION_REQUIRED", "Reload this profile before changing its role.", 428);
        transactionRoleChange = await assignWorkspaceRole(tx, {
          actorId: actor.id, targetUserId: params.userId, requestedRole: body.role, settings: profileSettings,
        });
      }
      const effectiveCapacity = body.capacityHours === undefined ? fresh.employment?.capacityHours ?? null : body.capacityHours;
      const effectiveMinimum = body.minimumHours === undefined ? fresh.employment?.minimumHours ?? null : body.minimumHours;
      if (effectiveMinimum != null && effectiveCapacity != null && effectiveMinimum > effectiveCapacity) throw new PeopleGovernanceError("PROFILE_CAPACITY_INVALID", "Minimum hours cannot exceed capacity hours.", 400);
      if (body.managerUserId !== undefined) await validateManagerAssignment(tx, params.userId, body.managerUserId, actorMembership.workspaceId);
      await tx.user.update({
        where: { id: params.userId },
        data: {
          username: body.username ? normalizeAuthUsername(body.username) : undefined,
          employeeNumber: body.employeeNumber?.trim() || (body.employeeNumber === null ? null : undefined),
          displayName: body.displayName,
          email: body.email,
          avatarUrl: body.avatarUrl,
          legalName: body.legalName,
          preferredName: body.preferredName,
          pronouns: body.pronouns,
          phoneNumber: body.phoneNumber,
          alternatePhoneNumber: body.alternatePhoneNumber,
          alternateEmails: body.alternateEmails ? JSON.stringify(body.alternateEmails) : undefined,
          addressLine1: body.addressLine1,
          addressLine2: body.addressLine2,
          city: body.city,
          stateProvince: body.stateProvince,
          postalCode: body.postalCode,
          country: body.country,
          emergencyContactName: body.emergencyContactName,
          emergencyContactPhone: body.emergencyContactPhone,
          emergencyContactRelation: body.emergencyContactRelation,
          accountType: body.accountType,
          invitedById: body.invitedById,
          hideLegalName: body.hideLegalName,
          hideLocation: body.hideLocation,
          customProfileFields: body.customProfileFields ? JSON.stringify(validateCustomProfileFields({ ...parseProfileJsonRecord(fresh.customProfileFields), ...body.customProfileFields }, profileDefinitions)) : undefined,
          profileRevision: { increment: 1 },
          notes: body.notes,
          archived: body.archived,
          toolPermissions: body.toolPermissions ? JSON.stringify(body.toolPermissions) : undefined,
          projectPermissions: body.projectPermissions ? JSON.stringify(body.projectPermissions) : undefined,
        },
        include: {
          memberships: true,
          studioTeamMemberships: { where: { archived: false }, include: { team: true } },
          _count: { select: { assignedCards: true, comments: true, activityEvents: true } },
        },
      });
      const membership = await tx.workspaceMember.findFirst({ where: { userId: params.userId }, orderBy: { workspaceId: "asc" } });
      if (membership) await syncUserWorkforceAuthorities(tx, {
        workspaceId: membership.workspaceId, userId: params.userId,
        input: { ...body, expertise: body.expertise === undefined ? undefined : normalizeExpertise(body.expertise) },
      });
      const person = await tx.user.findUniqueOrThrow({
        where: { id: params.userId },
        include: { memberships: true, ...WORKFORCE_USER_AUTHORITY_INCLUDE, _count: { select: { assignedCards: true, comments: true, activityEvents: true } } },
      });
      return { person, roleChange: transactionRoleChange };
    });
    updated = outcome.person;
    roleChange = outcome.roleChange;
  } catch (error) {
    if (error instanceof PeopleGovernanceError) return reply.code(error.statusCode).send({ ok: false, code: error.code, error: error.message, ...(error.details || {}) });
    throw error;
  }
  if (roleChange?.changed) {
    await logSecurityEvent({
      event: "account.role_changed",
      actorUserId: actor.id,
      targetUserId: params.userId,
      workspaceId: roleChange.workspaceId,
      result: "SUCCESS",
      reasonCode: "ADMIN_ROLE_REASSIGNMENT",
      request,
      metadata: { previousRole: roleChange.from, newRole: roleChange.to },
    });
  }
  await logActivity({
    userId: actor?.id,
    type: body.accessExpiresAt !== undefined || body.accountType !== undefined ? "access" : "updated",
    entityType: "user",
    entityId: updated.id,
    title: body.accessExpiresAt !== undefined || body.accountType !== undefined ? "User access updated" : "User updated",
    message: `${updated.displayName || updated.username}${body.accessExpiresAt ? ` · access until ${body.accessExpiresAt}` : body.accessExpiresAt === null ? " · no expiry" : ""}`,
  });
  return {
    ...serializeUserPrivate(updated),
    workspaceRole: body.role || updated.memberships.find((membership: any) => membership.workspaceId === actorMembership.workspaceId)?.role || "member",
    counts: updated._count,
    lastActivityAt: null,
  };
});
app.get("/api/users/:userId/profile", async (request, reply) => {
  const viewer = await getCurrentUser(request);
  if (!viewer) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: viewer.id }, select: { workspaceId: true }, orderBy: { workspaceId: "asc" },
  });
  if (!membership) return reply.code(403).send({ ok: false, code: "WORKSPACE_ACCESS_DENIED" });
  const workspaceId = membership.workspaceId;
  const viewerRole = viewer ? await getWorkspaceRole(viewer.id) : null;
  const params = z.object({ userId: z.string() }).parse(request.params);
  const includeRawSummary = Boolean(viewer && ["owner", "admin"].includes(String(viewerRole || "")));
  const canSeeActivity = Boolean(viewer && hasToolPermission(viewer, viewerRole, "activity", "view"));
  const user = await prisma.user.findFirst({
    where: { id: params.userId, memberships: { some: { workspaceId } } },
    include: {
      memberships: true,
      ...WORKFORCE_USER_AUTHORITY_INCLUDE,
      ...(includeRawSummary ? { _count: { select: { assignedCards: true, comments: true, activityEvents: true } } } : {}),
      ...(canSeeActivity ? {
        activityEvents: {
          orderBy: { createdAt: "desc" },
          take: 60,
          include: {
            user: { include: { workforceStatus: true } },
            project: { include: { memberships: { where: { status: "active" } } } },
            board: true,
            whiteboard: true,
            card: { include: { list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } } } },
          },
        },
      } : {}),
    },
  });
  if (!user) return reply.code(404).send({ ok: false, code: "USER_NOT_FOUND" });
  const includePrivate = await canViewPrivateUserProfile(viewer, user.id);
  const detailDisclosure = userDisclosureObligations({ includePrivate, includeSecurityState: includePrivate, surface: "api" });
  const viewerIsSelf = Boolean(viewer?.id && viewer.id === user.id);
  const profileFieldDefinitions = profileFieldDefinitionsSchema.parse((await readSettings()).studioPeopleProfileFields || []);
  const rawCustomFields = parseProfileJsonRecord(user.customProfileFields);
  const visibleProfileFields = profileFieldDefinitions.filter((field) => field.visibility === "studio" || (field.visibility === "managers" && includePrivate) || (field.visibility === "private" && viewerIsSelf));
  const visibleCustomFields = Object.fromEntries(visibleProfileFields.filter((field) => rawCustomFields[field.id] !== undefined).map((field) => [field.id, rawCustomFields[field.id]]));
  const visibleActivity = canSeeActivity ? (await authorization.filterActivityEventsForRequest(request, user.activityEvents || [], "view")).slice(0, 20) : [];
  const directReports = await prisma.user.findMany({
    where: { archived: false, memberships: { some: { workspaceId } }, employment: { is: { managerUserId: user.id, active: true } } },
    include: WORKFORCE_USER_AUTHORITY_INCLUDE,
    orderBy: [{ displayName: "asc" }, { username: "asc" }],
    take: 500,
  });
  const managerMember = user.employment?.managerUserId
    ? await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.employment.managerUserId } },
      select: { userId: true },
    })
    : null;
  return applyDisclosureObligations({
    ...(includePrivate ? serializeUserPrivate(user) : serializeUserPublicProfile(user)),
    customProfileFields: visibleCustomFields,
    privateProfile: includePrivate,
    sensitiveProfileHidden: !includePrivate,
    workspaceRole: user.memberships.find((row: any) => row.workspaceId === workspaceId)?.role || "member",
    ...(includeRawSummary ? { counts: user._count } : {}),
    lastActivityAt: visibleActivity[0]?.createdAt ?? null,
    recentActivity: visibleActivity.map(serializeActivityEvent),
    manager: managerMember ? user.employment?.manager || null : null,
    directReports: directReports.map(serializeUserLite),
    profileFieldDefinitions: visibleProfileFields,
  }, detailDisclosure);
});
}
