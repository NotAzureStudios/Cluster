import { recordPerformanceMetric } from "../../core/performance";
import type { CommandSearchPayload } from "../application/application-models";

export function recordCommandSearchPerformance(payload: CommandSearchPayload) {
  if (!payload.meta) return;
  recordPerformanceMetric({
    name: "server command search",
    category: "search",
    durationMs: payload.meta.elapsedMs,
    startedAt: Date.now() - payload.meta.elapsedMs,
    detail: {
      candidateCount: payload.meta.candidateCount ?? payload.meta.count,
      indexedCount: payload.meta.totalIndexed ?? payload.meta.count,
      cached: payload.meta.cached ?? false,
      indexAgeMs: payload.meta.indexAgeMs ?? null,
      cacheEntries: payload.meta.cacheEntries ?? 0,
      refreshingProjects: payload.meta.refreshingProjects ?? 0,
      indexDirty: payload.meta.indexDirty ?? false,
    },
  });
}
