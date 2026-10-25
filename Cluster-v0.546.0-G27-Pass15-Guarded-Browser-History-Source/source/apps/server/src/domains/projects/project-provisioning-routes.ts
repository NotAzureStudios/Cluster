import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { resolveClusterProductionProfile, resolveClusterProjectDefinitionForProfile } from "@cluster/shared";
import type { ClusterOperationRuntime } from "../../core/operation-runtime.js";
import { buildProjectProvisioningPreview, projectProvisioningRequestSchema } from "./project-provisioning.js";
import { projectSourceControlPlan } from "./project-source-provisioning.js";

export function registerProjectProvisioningRoutes(input: {
  app: FastifyInstance;
  prisma: any;
  operationRuntime: ClusterOperationRuntime;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  decorateUserForClient: (user: any) => Promise<any>;
  hasToolPermission: (...args: any[]) => boolean;
  configuredProjectType: (type: string) => Promise<any>;
}) {
  const { app, prisma, operationRuntime, getCurrentUser, decorateUserForClient, hasToolPermission, configuredProjectType } = input;

  async function requireCreateAccess(request: FastifyRequest, reply: FastifyReply) {
    const user = await getCurrentUser(request);
    const decorated = await decorateUserForClient(user);
    if (!decorated?.isAdmin && !hasToolPermission(user, decorated?.workspaceRole, "projects", "edit")) {
      reply.code(403).send({ ok: false, code: "PROJECT_CREATE_REQUIRED", error: "Project edit permission is required." });
      return null;
    }
    return { user, decorated };
  }

  async function validateRequest(request: FastifyRequest, reply: FastifyReply) {
    const auth = await requireCreateAccess(request, reply);
    if (!auth) return null;
    const body = projectProvisioningRequestSchema.parse(request.body || {});
    if (body.startDate && body.targetDate && body.targetDate.getTime() < body.startDate.getTime()) return reply.code(400).send({ ok: false, code: "PROJECT_DATE_RANGE_INVALID", error: "Project target date must be on or after the start date." }) as any;
    const workspace = await prisma.workspace.findFirst();
    if (!workspace) return reply.code(409).send({ ok: false, code: "WORKSPACE_NOT_READY", error: "Complete workspace setup before creating projects." }) as any;
    const memberIds = Array.from(new Set([body.leadId, ...body.memberIds]));
    if (!memberIds.includes(body.leadId)) memberIds.unshift(body.leadId);
    const members = await prisma.workspaceMember.findMany({ where: { workspaceId: workspace.id, userId: { in: memberIds }, user: { archived: false } }, select: { userId: true } });
    if (members.length !== memberIds.length) return reply.code(400).send({ ok: false, code: "PROJECT_MEMBERSHIP_INVALID", error: "Every project member must be an active workspace member." }) as any;
    const baseDefinition = await configuredProjectType(body.projectType);
    const profile = resolveClusterProductionProfile(body.productionProfile || "generic", baseDefinition);
    const definition = resolveClusterProjectDefinitionForProfile(baseDefinition, profile.id);
    const sourcePlan = projectSourceControlPlan(definition, profile.id, body.sourceControl);
    if (sourcePlan.required && body.sourceControl === "disabled" && !body.sourceRepositoryId) return reply.code(400).send({ ok: false, code: "PROJECT_SOURCE_REQUIRED", error: `${definition.label} projects require Source Control.` }) as any;
    return { ...auth, workspace, body: { ...body, projectType: definition.id, productionProfile: profile.id, memberIds }, definition, profile };
  }

  app.post("/api/projects/provision/preview", async (request, reply) => {
    const validated = await validateRequest(request, reply);
    if (!validated || reply.sent) return;
    return { ok: true, preview: buildProjectProvisioningPreview(validated.body, validated.definition) };
  });

  app.post("/api/projects/provision", async (request, reply) => {
    const validated = await validateRequest(request, reply);
    if (!validated || reply.sent) return;
    const operation = await operationRuntime.enqueue({
      type: "project.provision",
      queue: "default",
      workspaceId: validated.workspace.id,
      createdById: validated.user.id,
      dedupeKey: `project-provision:${validated.body.provisioningKey}`,
      maxAttempts: 5,
      priority: 15,
      costUnits: 4,
      payload: { actorId: validated.user.id, workspaceId: validated.workspace.id, request: validated.body, typeDefinition: validated.definition },
      authorization: { actorUserId: validated.user.id, action: "contribute", resource: { kind: "tool", tool: "projects" }, minimum: "edit", tool: "projects" },
    });
    return reply.code(202).send({ ok: true, operation, preview: buildProjectProvisioningPreview(validated.body, validated.definition) });
  });

  app.get("/api/projects/provision/:operationId", async (request, reply) => {
    const auth = await requireCreateAccess(request, reply);
    if (!auth) return;
    const { operationId } = z.object({ operationId: z.string().min(1).max(200) }).parse(request.params);
    const operation = await operationRuntime.get(operationId);
    if (!operation || (!auth.decorated?.isAdmin && operation.createdById !== auth.user.id)) return reply.code(404).send({ ok: false, code: "PROJECT_PROVISION_OPERATION_NOT_FOUND", error: "Project provisioning operation not found." });
    return { ok: true, operation };
  });

  app.post("/api/projects/provision/:operationId/retry", async (request, reply) => {
    const auth = await requireCreateAccess(request, reply);
    if (!auth) return;
    const { operationId } = z.object({ operationId: z.string().min(1).max(200) }).parse(request.params);
    const current = await operationRuntime.get(operationId);
    if (!current || (!auth.decorated?.isAdmin && current.createdById !== auth.user.id)) return reply.code(404).send({ ok: false, error: "Project provisioning operation not found." });
    const operation = await operationRuntime.retry(operationId);
    if (!operation) return reply.code(409).send({ ok: false, code: "PROJECT_PROVISION_RETRY_NOT_ALLOWED", error: "This provisioning operation is not retryable." });
    return { ok: true, operation };
  });
}
