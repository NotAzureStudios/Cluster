import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { buildCursorPage, cursorWhere, decodeCursor } from "../../core/cursor-pagination.js";
import { buildPeopleAccountWhere } from "./people-account-management-query.js";

const managementQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(1000).optional(),
  search: z.string().trim().max(120).default(""),
  status: z.enum(["all", "setup", "restricted", "expiring", "expired", "archived"]).default("all"),
  accountType: z.enum(["all", "employee", "contractor", "client", "guest"]).default("all"),
  role: z.string().trim().max(80).default(""),
});

/**
 * Admin-only account management directory. Unlike the general People Data View,
 * filtering is performed in PostgreSQL BEFORE cursor pagination. We only select
 * fields necessary for the account list, not workforce context or security secrets.
 */
export function registerPeopleAccountManagementRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
}) {
  const { app, prisma, getCurrentUser } = deps;

  app.get("/api/admin/users/management", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });

    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: actor.id },
      orderBy: { workspaceId: "asc" },
      select: { workspaceId: true, role: true },
    });
    if (!membership || !["owner", "admin"].includes(membership.role))
      return reply.code(403).send({ ok: false, code: "ROLE_ADMIN_REQUIRED" });

    const query = managementQuerySchema.parse(request.query || {});
    const cursor = decodeCursor(query.cursor);
    if (query.cursor && !cursor)
      return reply.code(400).send({ ok: false, code: "PEOPLE_ACCOUNT_CURSOR_INVALID", error: "Invalid account list cursor. Refresh the list." });

    const where = buildPeopleAccountWhere(membership.workspaceId, query);
    const rowsWhere = { AND: [where, ...(cursor ? [cursorWhere(cursor, "updatedAt", "desc")] : [])] };

    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where: rowsWhere,
        select: {
          id: true, username: true, displayName: true, preferredName: true,
          email: true, accountType: true, accountState: true, archived: true,
          accessExpiresAt: true, createdAt: true, updatedAt: true, lastSeenAt: true,
          memberships: {
            where: { workspaceId: membership.workspaceId },
            select: { role: true },
            take: 1,
          },
          employment: {
            select: {
              department: { select: { name: true } },
              jobRole: { select: { name: true } },
              manager: { select: { id: true, username: true, displayName: true } },
            },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
      }),
    ]);

    const page = buildCursorPage(rows, query.limit, "updatedAt");
    return {
      items: page.items.map((user: any) => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.preferredName || user.username,
        email: user.email || null,
        accountType: user.accountType || "employee",
        accountState: user.accountState || "ACTIVE",
        workspaceRole: user.memberships[0]?.role || "member",
        department: user.employment?.department?.name || null,
        jobTitle: user.employment?.jobRole?.name || null,
        manager: user.employment?.manager ? {
          id: user.employment.manager.id,
          displayName: user.employment.manager.displayName || user.employment.manager.username,
        } : null,
        accessExpiresAt: user.accessExpiresAt?.toISOString() || null,
        lastSeenAt: user.lastSeenAt?.toISOString() || null,
        updatedAt: user.updatedAt.toISOString(),
        archived: Boolean(user.archived),
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      total,
    };
  });
}
