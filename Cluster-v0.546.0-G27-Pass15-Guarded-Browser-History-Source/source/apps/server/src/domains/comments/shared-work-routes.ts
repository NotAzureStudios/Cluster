import { z } from "zod";
import {
  SHARED_WORK_WATCH_ENTITY_KINDS,
  SHARED_WORK_WATCH_SCOPES,
} from "@cluster/shared";
import type { ServerRouteRegistrationDeps } from "../../app/server-composition-types.js";
import { createSubscriptionService } from "./subscription-service.js";

const watchEntitySchema = z.object({
  kind: z.enum(SHARED_WORK_WATCH_ENTITY_KINDS),
  id: z.string().trim().min(1).max(240),
  label: z.string().trim().min(1).max(240).nullable().optional(),
  projectId: z.string().trim().max(240).nullable().optional(),
  href: z.string().trim().max(1200).nullable().optional(),
});
const watchScopeSchema = z.enum(SHARED_WORK_WATCH_SCOPES);
const watchQuerySchema = z.object({
  entityType: z.enum(SHARED_WORK_WATCH_ENTITY_KINDS),
  entityId: z.string().trim().min(1).max(240),
});

function watchAccessKind(kind: string) {
  return kind === "control" ? "project_control" : kind;
}

export function registerSharedWorkRoutes(
  deps: ServerRouteRegistrationDeps & {
    enforceEntityCommentAccess: (
      request: any,
      reply: any,
      entityType: string,
      entityId: string,
      minimum?: string,
    ) => Promise<boolean>;
  },
) {
  const { app, prisma, getCurrentUser, enforceEntityCommentAccess } = deps;
  const subscriptions = createSubscriptionService(prisma);

  async function access(request: any, reply: any, entity: { kind: string; id: string }) {
    return enforceEntityCommentAccess(request, reply, watchAccessKind(entity.kind), entity.id, "view");
  }


  app.get("/api/shared-work/watch", async (request, reply) => {
    const query = watchQuerySchema.parse(request.query);
    if (!(await access(request, reply, { kind: query.entityType, id: query.entityId }))) return;

    const user = await getCurrentUser(request);
    if (!user) return { watching: false, scopes: [], records: [] };

    return subscriptions.get({ kind: watchAccessKind(query.entityType) as any, id: query.entityId }, user.id);
  });

  app.put("/api/shared-work/watch", async (request, reply) => {
    const body = z.object({
      entity: watchEntitySchema,
      scopes: z.array(watchScopeSchema).max(SHARED_WORK_WATCH_SCOPES.length).default(["all"]),
      muted: z.boolean().optional().default(false),
    }).parse(request.body);
    if (!(await access(request, reply, body.entity))) return;

    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, error: "Login required." });

    return subscriptions.set({ entity: body.entity, userId: user.id, scopes: body.scopes, muted: body.muted });
  });

  app.delete("/api/shared-work/watch", async (request, reply) => {
    const query = watchQuerySchema.extend({ scope: watchScopeSchema.optional() }).parse(request.query);
    if (!(await access(request, reply, { kind: query.entityType, id: query.entityId }))) return;

    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, error: "Login required." });

    await subscriptions.remove({ kind: watchAccessKind(query.entityType) as any, id: query.entityId }, user.id, query.scope || null);
    return { ok: true };
  });
}
