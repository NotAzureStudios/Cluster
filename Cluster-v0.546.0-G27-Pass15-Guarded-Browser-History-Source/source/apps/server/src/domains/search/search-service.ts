import type { CommandSearchQuery } from "./search-schemas.js";
import type { SearchCorpus } from "./search-repository.js";
import type { SearchIndexSnapshot } from "./search-index-types.js";
import { BoundedCache } from "../../core/bounded-cache.js";
import { applyDisclosureObligations, userDisclosureObligations } from "../access/disclosure.js";
import { buildIndex, buildPostings, mergeProjectCorpus, normalize } from "./search-index-builder.js";
import {
  candidateIndexes,
  operatorMatches,
  parseQuery,
  PRIORITY_RANK,
  score,
  SEARCH_FULL_REBUILD_MS,
  SEARCH_STALE_REBUILD_MS,
} from "./search-query-runtime.js";

type RankedCandidate = { index: number; value: number; reason: string };

type SearchServiceDependencies = {
  loadCorpus: () => Promise<SearchCorpus>;
  loadProjectCorpus?: (projectId: string) => Promise<SearchCorpus>;
  loadUserCorpus?: (userId: string) => Promise<SearchCorpus>;
  loadAccessRules?: () => Promise<any[]>;
  serializeUserLite: (user: any) => any;
  serializeProjectSummary: (project: any) => any;
};

export function createSearchService(deps: SearchServiceDependencies) {
  let snapshot: SearchIndexSnapshot | null = null;
  let dirty = true;
  // Every invalidation advances this epoch. A rebuild begun before a mutation
  // must never publish an older full-corpus snapshot after that mutation.
  let mutationRevision = 0;
  let rebuildPromise: Promise<SearchIndexSnapshot> | null = null;
  let indexRevision = 0;
  let totalSearches = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  let lastSearchElapsedMs = 0;
  let slowestSearchElapsedMs = 0;
  const projectRefreshes = new Map<string, Promise<void>>();
  const queuedProjectRefreshes = new Set<string>();
  const userRefreshes = new Map<string, Promise<void>>();
  const queuedUserRefreshes = new Set<string>();
  let accessRefreshPromise: Promise<void> | null = null;
  let queuedAccessRefresh = false;
  let incrementalProjectRefreshes = 0;
  let incrementalUserRefreshes = 0;
  let incrementalAccessRefreshes = 0;
  let fullRebuilds = 0;
  // Only cache ranking facts from the current index, never authorization decisions or
  // user-visible result payloads. Permissions are evaluated on *every* request.
  const rankingCache = new BoundedCache<string, RankedCandidate[]>({
    maxEntries: 200,
    maxWeight: Math.max(2 * 1024 * 1024, Number(process.env.CLUSTER_SEARCH_RANKING_CACHE_BYTES || 8 * 1024 * 1024)),
    weightOf: (rows) => 64 + rows.length * 64,
  });

  function recordElapsed(startedAt: number) {
    const elapsed = Math.max(0, Math.round(performance.now() - startedAt));
    lastSearchElapsedMs = elapsed;
    slowestSearchElapsedMs = Math.max(slowestSearchElapsedMs, elapsed);
    return elapsed;
  }

  async function rebuild() {
    if (rebuildPromise) return rebuildPromise;
    rebuildPromise = (async () => {
      // Under sustained updates, fail closed rather than returning stale
      // search data (including stale permissions). The next request may retry.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const startedAtRevision = mutationRevision;
        const next = buildIndex(await deps.loadCorpus());
        if (mutationRevision !== startedAtRevision) continue;
        fullRebuilds += 1;
        snapshot = next;
        indexRevision += 1;
        dirty = false;
        rankingCache.clear();
        return next;
      }
      dirty = true;
      throw new Error("Search index changed repeatedly during rebuild; retry after mutations settle.");
    })().finally(() => { rebuildPromise = null; });
    return rebuildPromise;
  }

  async function refreshProject(projectId: string) {
    if (!deps.loadProjectCorpus || !snapshot) { dirty = true; return; }
    const existing = projectRefreshes.get(projectId);
    if (existing) {
      // Do not lose a second mutation that arrives while this project is already loading.
      queuedProjectRefreshes.add(projectId);
      return existing;
    }
    const task = (async () => {
      if (rebuildPromise) await rebuildPromise;
      const baselineSnapshot = snapshot;
      if (!baselineSnapshot) return;
      const partial = await deps.loadProjectCorpus!(projectId);
      if (!snapshot) return;
      if (snapshot !== baselineSnapshot) {
        // A full rebuild or another project merge won the race. Replay this project against
        // the newest snapshot instead of merging a partial corpus loaded from an older base.
        queuedProjectRefreshes.add(projectId);
        return;
      }
      const partialIndex = buildIndex({ ...partial, users: baselineSnapshot.corpus.users });
      const items = [...baselineSnapshot.items.filter((item) => item.projectId !== projectId), ...partialIndex.items.filter((item) => item.kind !== "person")];
      snapshot = {
        ...baselineSnapshot,
        loadedAt: Date.now(),
        corpus: mergeProjectCorpus(baselineSnapshot.corpus, partial, projectId),
        items,
        postings: buildPostings(items),
      };
      incrementalProjectRefreshes += 1;
      indexRevision += 1;
      rankingCache.clear();
    })().finally(() => {
      projectRefreshes.delete(projectId);
      if (queuedProjectRefreshes.delete(projectId)) void refreshProject(projectId).catch(() => invalidate());
    });
    projectRefreshes.set(projectId, task);
    return task;
  }

  async function refreshUser(userId: string) {
    if (!deps.loadUserCorpus || !snapshot) { dirty = true; return; }
    const existing = userRefreshes.get(userId);
    if (existing) {
      queuedUserRefreshes.add(userId);
      return existing;
    }
    const task = (async () => {
      if (rebuildPromise) await rebuildPromise;
      const baselineSnapshot = snapshot;
      if (!baselineSnapshot) return;
      const partial = await deps.loadUserCorpus!(userId);
      if (!snapshot) return;
      if (snapshot !== baselineSnapshot) {
        queuedUserRefreshes.add(userId);
        return;
      }
      const partialIndex = buildIndex(partial);
      const items = [
        ...baselineSnapshot.items.filter((item) => !(item.kind === "person" && item.id === userId)),
        ...partialIndex.items.filter((item) => item.kind === "person"),
      ];
      snapshot = {
        ...baselineSnapshot,
        loadedAt: Date.now(),
        corpus: {
          ...baselineSnapshot.corpus,
          users: [...baselineSnapshot.corpus.users.filter((row: any) => String(row.id) !== userId), ...partial.users],
        },
        items,
        postings: buildPostings(items),
      };
      incrementalUserRefreshes += 1;
      indexRevision += 1;
      rankingCache.clear();
    })().finally(() => {
      userRefreshes.delete(userId);
      if (queuedUserRefreshes.delete(userId)) void refreshUser(userId).catch(() => invalidate());
    });
    userRefreshes.set(userId, task);
    return task;
  }

  async function refreshAccessRules() {
    if (!deps.loadAccessRules || !snapshot) { dirty = true; return; }
    if (accessRefreshPromise) {
      queuedAccessRefresh = true;
      return accessRefreshPromise;
    }
    accessRefreshPromise = (async () => {
      if (rebuildPromise) await rebuildPromise;
      const baselineSnapshot = snapshot;
      if (!baselineSnapshot) return;
      const accessRules = await deps.loadAccessRules!();
      if (!snapshot || snapshot !== baselineSnapshot) {
        queuedAccessRefresh = true;
        return;
      }
      snapshot = {
        ...baselineSnapshot,
        loadedAt: Date.now(),
        corpus: { ...baselineSnapshot.corpus, accessRules },
      };
      incrementalAccessRefreshes += 1;
      indexRevision += 1;
      rankingCache.clear();
    })().finally(() => {
      accessRefreshPromise = null;
      if (queuedAccessRefresh) {
        queuedAccessRefresh = false;
        void refreshAccessRules().catch(() => invalidate());
      }
    });
    return accessRefreshPromise;
  }

  async function index() {
    if (!snapshot || dirty) return rebuild();
    // Never answer with an older indexed projection while a known resource/access
    // mutation is still refreshing it. A periodic age rebuild may remain async.
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const pending = [...projectRefreshes.values(), ...userRefreshes.values(), ...(accessRefreshPromise ? [accessRefreshPromise] : [])];
      if (!pending.length) break;
      await Promise.all(pending);
    }
    // A continuously moving index is safer to rebuild than to serve a known
    // pending privilege projection. Do not return an old ACL snapshot.
    if (projectRefreshes.size || userRefreshes.size || accessRefreshPromise || dirty) return rebuild();
    if (Date.now() - snapshot!.loadedAt > SEARCH_FULL_REBUILD_MS) void rebuild().catch(() => undefined);
    return snapshot!;
  }

  async function search(options: CommandSearchQuery & {
    userId: string;
    canViewItem: (item: SearchIndexSnapshot["items"][number], project: any | null, accessRules: any[]) => boolean | Promise<boolean>;
    prepareBatch?: (items: SearchIndexSnapshot["items"]) => Promise<void>;
  }) {
    const startedAt = performance.now();
    totalSearches += 1;
    const parsed = parseQuery(options.q, options.scope);
    const normalizedQuery = normalize(parsed.term);
    const hasOperators = Object.keys(parsed.operators).length > 0;
    if (normalizedQuery.length < 2 && !hasOperators) return {
      users: [], projects: [], cards: [], results: [],
      meta: { query: options.q, scope: options.scope, count: 0, elapsedMs: recordElapsed(startedAt), cached: false, indexAgeMs: snapshot ? Date.now() - snapshot.loadedAt : 0, rebuilding: Boolean(rebuildPromise), operators: parsed.operators, cacheEntries: rankingCache.size, refreshingProjects: projectRefreshes.size, queuedProjectRefreshes: queuedProjectRefreshes.size, indexDirty: dirty, indexRevision },
    };
    const current = await index();
    const projectById = new Map(current.corpus.projects.map((project) => [String(project.id), project]));
    // Rank only matching candidates. The earlier whole-corpus visibility scan both
    // multiplied authorization calls on each keystroke and could reuse revoked
    // access for its five-second lifetime. Cache only non-sensitive ranking indices.
    const cacheKey = `${indexRevision}:${options.userId}:${options.scope}:${normalize(options.q)}`;
    let rankedCandidates = rankingCache.get(cacheKey);
    const rankingCached = rankedCandidates !== undefined;
    if (rankingCached) cacheHits += 1;
    else {
      cacheMisses += 1;
      const fuzzyScoreCache = new Map<string, number>();
      rankedCandidates = candidateIndexes(current, normalizedQuery)
        .filter((candidateIndex) => operatorMatches(current.items[candidateIndex], parsed, options.userId))
        .map((candidateIndex) => ({ index: candidateIndex, ...score(current.items[candidateIndex], normalizedQuery, fuzzyScoreCache) }))
        .filter((row) => row.value >= 0)
        .sort((left, right) => {
          const a = current.items[left.index];
          const b = current.items[right.index];
          if (parsed.sort === "title") return a.title.localeCompare(b.title);
          if (parsed.sort === "recent") return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
          if (parsed.sort === "oldest") return String(a.updatedAt || "9999").localeCompare(String(b.updatedAt || "9999"));
          if (parsed.sort === "due") return String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999"));
          if (parsed.sort === "priority") return (PRIORITY_RANK[normalize(a.priority)] ?? 99) - (PRIORITY_RANK[normalize(b.priority)] ?? 99) || right.value - left.value;
          return right.value - left.value || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || a.title.localeCompare(b.title);
        });
      rankingCache.set(cacheKey, rankedCandidates, SEARCH_STALE_REBUILD_MS);
    }

    const ranked: Array<{ item: SearchIndexSnapshot["items"][number]; value: number; reason: string }> = [];
    // Bounded concurrency avoids serializing hundreds of ACL checks while never
    // evaluating more than a small window beyond the requested visible results.
    const admissionBatch = Math.max(1, Math.min(12, options.limit));
    for (let offset = 0; offset < rankedCandidates.length && ranked.length < options.limit; offset += admissionBatch) {
      const batch = rankedCandidates.slice(offset, offset + admissionBatch);
      if (options.prepareBatch) await options.prepareBatch(batch.map(({ index }) => current.items[index]));
      const grants = await Promise.all(batch.map(({ index: candidateIndex }) => {
        const item = current.items[candidateIndex];
        const project = item.projectId ? projectById.get(String(item.projectId)) || null : null;
        return options.canViewItem(item, project, current.corpus.accessRules);
      }));
      for (let i = 0; i < batch.length && ranked.length < options.limit; i += 1) {
        if (!grants[i]) continue;
        const { index: candidateIndex, value, reason } = batch[i];
        ranked.push({ item: current.items[candidateIndex], value, reason });
      }
    }
    const results = ranked.map(({ item, value, reason }) => ({
      id: item.id, kind: item.kind, title: item.title, detail: item.detail,
      projectId: item.projectId || null, projectName: item.projectName || null, boardId: item.boardId || null, boardName: item.boardName || null, listName: item.listName || null, resource: item.resource || null,
      cardId: item.cardId || null, whiteboardId: item.whiteboardId || null, status: item.status || null,
      assigneeId: item.assigneeId || null, priority: item.priority || null, updatedAt: item.updatedAt || null,
      createdAt: item.createdAt || null, dueDate: item.dueDate || null,
      personId: item.kind === "person" ? item.id : null, avatarUrl: item.avatarUrl || null,
      department: item.department || null, teamName: item.teamName || null, roleName: item.roleName || null,
      presence: item.presence || null, location: item.location || null, timezone: item.timezone || null,
      labels: item.labels, categories: item.categories, flags: item.flags,
      score: value, matchReason: reason, relationshipSummary: item.relationshipSummary,
    }));
    const projects = ranked.filter((row) => row.item.kind === "project").map((row) => deps.serializeProjectSummary(row.item.raw));
    const userSearchDisclosure = userDisclosureObligations({ includePrivate: false, includeSecurityState: false, surface: "search" });
    const users = ranked
      .filter((row) => row.item.kind === "person")
      .map((row) => applyDisclosureObligations(deps.serializeUserLite(row.item.raw), userSearchDisclosure));
    const cards = ranked.filter((row) => row.item.kind === "card").map(({ item }) => {
      const card = item.raw;
      return {
        id: card.id, title: card.title, priority: card.priority, dueDate: card.dueDate,
        boardId: card.list.board.id, boardName: card.list.board.name,
        projectId: card.list.board.project.id, projectName: card.list.board.project.name, listTitle: card.list.title,
      };
    });
    const payload = {
      users, projects, cards, results,
      meta: {
        query: options.q, scope: options.scope, count: results.length,
        elapsedMs: recordElapsed(startedAt), cached: rankingCached,
        indexAgeMs: Date.now() - current.loadedAt, rebuilding: Boolean(rebuildPromise), operators: parsed.operators,
        cacheEntries: rankingCache.size, refreshingProjects: projectRefreshes.size, queuedProjectRefreshes: queuedProjectRefreshes.size, indexDirty: dirty, indexRevision,
      },
    };
    return payload;
  }

  function invalidate() {
    mutationRevision += 1;
    dirty = true;
    rankingCache.clear();
  }

  function invalidateProject(projectId?: string | null) {
    if (!projectId || !deps.loadProjectCorpus) { invalidate(); return; }
    mutationRevision += 1;
    rankingCache.clear();
    void refreshProject(projectId).catch(() => invalidate());
  }

  function invalidateChange(event: any) {
    const projectId = String(event?.projectId || event?.resource?.projectId || event?.payload?.projectId || "").trim();
    // Search normalization turns access_rule/access-rule into "access rule".
    // Canonicalize event identities independently so none of those spellings
    // silently bypasses the critical permission-rule refresh.
    const entityType = normalize(event?.payload?.entityType || event?.resource?.kind || "").replace(/[\s_-]+/g, "");
    const entityId = String(event?.payload?.entityId || event?.resource?.id || "").trim();
    // Access-rule changes can change global and cross-project access. Always
    // reload the full rule set before searching, even if the event has projectId.
    if (["accessrule", "access", "accesspolicy", "acl", "permission", "permissions", "role", "roles"].includes(entityType)) {
      mutationRevision += 1;
      rankingCache.clear();
      void refreshAccessRules().catch(() => invalidate());
      return;
    }
    if (entityId && ["user", "person", "member", "profile"].includes(entityType)) {
      mutationRevision += 1;
      rankingCache.clear();
      void refreshUser(entityId).catch(() => invalidate());
      if (projectId) invalidateProject(projectId);
      return;
    }
    if (projectId) {
      invalidateProject(projectId);
      return;
    }
    invalidate();
  }

  function diagnostics() {
    const corpus = snapshot?.corpus;
    return {
      loaded: Boolean(snapshot),
      loadedAt: snapshot?.loadedAt ? new Date(snapshot.loadedAt).toISOString() : null,
      indexAgeMs: snapshot ? Date.now() - snapshot.loadedAt : null,
      totalIndexed: snapshot?.items.length || 0,
      dirty,
      rebuilding: Boolean(rebuildPromise),
      refreshingProjects: projectRefreshes.size,
      queuedProjectRefreshes: queuedProjectRefreshes.size,
      refreshingUsers: userRefreshes.size,
      queuedUserRefreshes: queuedUserRefreshes.size,
      refreshingAccessRules: Boolean(accessRefreshPromise),
      incrementalProjectRefreshes,
      incrementalUserRefreshes,
      incrementalAccessRefreshes,
      fullRebuilds,
      cacheEntries: rankingCache.size,
      cacheBytes: rankingCache.weight,
      visibilityCacheEntries: 0,
      visibilityCacheBytes: 0,
      indexRevision,
      totalSearches,
      cacheHits,
      cacheMisses,
      lastSearchElapsedMs,
      slowestSearchElapsedMs,
      corpus: corpus ? {
        projects: corpus.projects.length, users: corpus.users.length, cards: corpus.cards.length, timelineItems: corpus.timelineItems.length,
        calendarEvents: corpus.calendarEvents.length, comments: corpus.cardComments.length, activityEvents: corpus.activityEvents.length,
        files: corpus.projectFiles.length + corpus.videoAssets.length, deliveryRecords: corpus.deliveryRecords.length, sourceReviews: corpus.sourceReviews.length, sourceCommits: (corpus.sourceCommits || []).length, relationships: corpus.projectRelationships.length,
        saturatedKinds: corpus.diagnostics?.saturatedKinds || [],
        limits: corpus.diagnostics?.limits || null,
      } : null,
    };
  }

  return { search, rebuild, invalidate, invalidateProject, invalidateChange, diagnostics };
}
