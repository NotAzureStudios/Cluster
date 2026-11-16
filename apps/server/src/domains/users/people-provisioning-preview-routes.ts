import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { PeopleGovernanceError } from "./people-governance.js";
import { requireAssignableStudioRole } from "./people-role-governance.js";
import { StudioReturnError, validateReturnAccessWindow } from "../studio-systems/studio-return-eligibility.js";

/** A read-only preflight, not a reservation or a substitute for POST /api/users.
 * Authorization, role policy, and uniqueness are rechecked at commit time. */
const previewSchema = z.object({
  username: z.string().trim().min(3).max(32),
  email: z.string().trim().email().max(254).optional().nullable(),
  displayName: z.string().trim().max(160).optional().nullable(),
  accountType: z.enum(["employee", "contractor", "client", "guest"]),
  role: z.string().trim().min(1).max(80),
  accessExpiresAt: z.string().max(64).optional().nullable(),
}).strict();

export function registerPeopleProvisioningPreviewRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  readSettings: () => Promise<Record<string, unknown>>;
  normalizeAuthUsername: (username: string) => string;
  authorization: {
    configuredToolPermissionsForRole: (role: string, user?: unknown) => Record<string, string>;
  };
}) {
  const { app, prisma, getCurrentUser, readSettings, normalizeAuthUsername, authorization } = deps;
  app.post("/api/admin/users/provisioning-preview", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });

    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: actor.id }, orderBy: { workspaceId: "asc" },
      select: { workspaceId: true, role: true },
    });
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return reply.code(403).send({ ok: false, code: "ROLE_ADMIN_REQUIRED" });
    }
    const parsed = previewSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, code: "PEOPLE_PROVISIONING_INPUT_INVALID", error: "Review the account fields before requesting a preview." });
    }
    const input = parsed.data;
    const blockers: Array<{ code: string; message: string }> = [];
    let username = input.username;
    try {
      username = normalizeAuthUsername(input.username);
    } catch (error) {
      blockers.push({ code: "USERNAME_INVALID", message: error instanceof Error ? error.message : "Choose a valid username." });
    }

    let role: { id: string; label: string; privileged: boolean } | null = null;
    try {
      role = requireAssignableStudioRole(await readSettings(), input.role);
      if (role.privileged && membership.role !== "owner") {
        blockers.push({ code: "ROLE_OWNER_REQUIRED", message: "Only a workspace owner can assign administrator or owner roles." });
      }
    } catch (error) {
      if (error instanceof PeopleGovernanceError) {
        blockers.push({ code: error.code, message: error.message });
      } else throw error;
    }

    try {
      const expiresAt = input.accessExpiresAt ? new Date(input.accessExpiresAt) : null;
      validateReturnAccessWindow(input.accountType, expiresAt);
    } catch (error) {
      if (error instanceof StudioReturnError) {
        blockers.push({ code: error.code, message: error.message });
      } else throw error;
    }
    if (!blockers.some((item) => item.code === "USERNAME_INVALID")) {
      const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } });
      if (existing) blockers.push({ code: "USERNAME_TAKEN", message: "That username is already assigned to an account." });
    }

    // Mirrors the configured role+identity-type permission layers for a NEW
    // member. Department, team, individual, project and resource scopes are
    // not applied, so this cannot be mistaken for actual post-login access.
    const toolPermissions = role && !blockers.some((item) => item.code.startsWith("ROLE_"))
      ? Object.entries(authorization.configuredToolPermissionsForRole(role.id, {
          accountType: input.accountType,
          toolPermissions: {},
          studioTeamMemberships: [],
        })).map(([tool, level]) => ({ tool, level: String(level) })).sort((a, b) => a.tool.localeCompare(b.tool))
      : [];

    return {
      ok: true,
      canCreate: blockers.length === 0,
      blockers,
      reviewedAt: new Date().toISOString(),
      username,
      role: role ? { id: role.id, label: role.label, privileged: role.privileged } : null,
      accountType: input.accountType,
      accessExpiresAt: input.accessExpiresAt || null,
      initialAccountState: "PASSWORD_CHANGE_REQUIRED",
      credentialMethod: "ONE_TIME_TEMPORARY_PASSWORD",
      toolPermissions,
      limitations: [
        "The preflight does not reserve the username or lock role policy. Creation revalidates every rule.",
        "Tool levels reflect initial role and identity policy only; effective access can be reduced by account, project, and resource policies.",
        "No Project membership or individual scoped grant is created. Request governed grants separately.",
        "No onboarding assignment is automatically created by this preview.",
      ],
    };
  });
}
