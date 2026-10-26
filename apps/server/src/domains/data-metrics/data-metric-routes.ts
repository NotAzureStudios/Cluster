import { clusterMetricInsights, type ClusterDataQuery } from "@cluster/shared";
import { z } from "zod";
import { apiError } from "../../core/api-response.js";
import type { ClusterDataMetricRegistry } from "../../core/data-metrics.js";

const metricIdSchema = z.string().trim().min(1).max(160).regex(/^[a-z0-9][a-z0-9._:-]*$/i);
const compareSchema = z.object({ from: z.string().datetime(), to: z.string().datetime() }).refine((value) => new Date(value.from).getTime() < new Date(value.to).getTime(), "Comparison range must end after it starts.");

export function registerDataMetricRoutes(input: {
  app: any;
  metrics: ClusterDataMetricRegistry;
  getCurrentUser: (request: any) => Promise<any | null>;
}) {
  input.app.get("/api/data-metrics", async (request: any, reply: any) => {
    const user = await input.getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    const definitions = [];
    for (const definition of input.metrics.list()) {
      const adapter = input.metrics.get(definition.id);
      if (adapter && await adapter.authorizeActor(String(user.id))) definitions.push(definition);
    }
    return { ok: true, schemaVersion: 1, metrics: definitions };
  });

  input.app.post("/api/data-metrics/:metricId/read", async (request: any, reply: any) => {
    const params = z.object({ metricId: metricIdSchema }).parse(request.params || {});
    const body = z.object({ query: z.unknown().optional(), compare: compareSchema.nullable().optional() }).parse(request.body || {});
    const user = await input.getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    const adapter = input.metrics.get(params.metricId);
    if (!adapter) return apiError(request, reply, 404, "METRIC_NOT_FOUND", "Metric is not registered.");
    if (!(await adapter.authorizeActor(String(user.id)))) return apiError(request, reply, 403, "METRIC_ACCESS_DENIED", "Metric access denied.");
    const read = await adapter.read({ actorId: String(user.id), query: (body.query || {}) as ClusterDataQuery, compare: body.compare || null });
    return { ok: true, definition: adapter.definition, read, insights: clusterMetricInsights(adapter.definition, read) };
  });
}
