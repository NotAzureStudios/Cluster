import { CLUSTER_REMOTE_SEARCH_SCOPE_IDS, COMMAND_SEARCH_KNOWN_OPERATORS, COMMAND_SEARCH_OPERATOR_ALIASES } from "@cluster/shared";
import type { CommandSearchQuery } from "./search-schemas.js";
import type { DateWindow, ParsedQuery, SearchIndexItem, SearchIndexSnapshot, SearchKind, SearchSort } from "./search-index-types.js";
import { normalize, tokenize, unique } from "./search-index-builder.js";

export const SEARCH_STALE_REBUILD_MS = 15_000;
export const SEARCH_FULL_REBUILD_MS = 5 * 60_000;
const SEARCH_KINDS = new Set<SearchKind>(CLUSTER_REMOTE_SEARCH_SCOPE_IDS.filter((kind): kind is SearchKind => kind !== "all") as SearchKind[]);
const SEARCH_KIND_ALIASES: Record<string, SearchKind> = {
  ticket: "ticket", tickets: "ticket", task: "card", tasks: "card",
  review: "source_review", reviews: "source_review", "source review": "source_review", "source reviews": "source_review", pullrequest: "source_review",
  commit: "source_commit", commits: "source_commit", revision: "source_commit", revisions: "source_commit",
  form: "studio_form", forms: "studio_form", "studio form": "studio_form",
  approval: "approval", approvals: "approval", "approval request": "approval",
  response: "form_submission", responses: "form_submission", submission: "form_submission", submissions: "form_submission",
  people: "person", user: "person", users: "person", member: "person", members: "person", teammate: "person", teammates: "person", team: "person",
  files: "file", library: "file", doc: "file", docs: "file", asset: "file", assets: "file",
  timelines: "timeline", milestone: "timeline", milestones: "timeline",
  boards: "board", cards: "card", whiteboards: "whiteboard", comments: "comment", events: "calendar",
  build: "build", builds: "build", artifact: "build", artifacts: "build", qa: "qa", test: "qa", tests: "qa", release: "release", releases: "release", notes: "release", control: "control", controls: "control", risk: "control", risks: "control", decision: "control", decisions: "control",
};
export const PRIORITY_RANK: Record<string, number> = { urgent: 0, critical: 0, high: 1, medium: 2, normal: 2, low: 3, none: 4 };

export function parseQuery(raw: string, requestedScope: CommandSearchQuery["scope"]): ParsedQuery {
  const operators: Record<string, string[]> = {};
  const operatorPattern = /(?:^|\s)([a-z][\w-]*):(?:"([^"]+)"|'([^']+)'|([^\s]+))/gi;
  const term = raw.replace(operatorPattern, (match, rawKey: string, quotedDouble: string, quotedSingle: string, unquoted: string) => {
    const key = COMMAND_SEARCH_OPERATOR_ALIASES[rawKey.toLowerCase()] || rawKey.toLowerCase();
    if (!COMMAND_SEARCH_KNOWN_OPERATORS.has(key)) return match;
    const value = String(quotedDouble || quotedSingle || unquoted || "").trim();
    if (value) (operators[key] ||= []).push(value);
    return " ";
  }).replace(/\s+/g, " ").trim();
  const typeValues = (operators.type || [])
    .flatMap((value) => value.split(","))
    .map((value) => normalize(value))
    .map((value) => SEARCH_KIND_ALIASES[value] || value)
    .filter((value): value is SearchKind => SEARCH_KINDS.has(value as SearchKind));
  const kinds = typeValues.length
    ? [...new Set(typeValues)]
    : requestedScope === "all" ? [] : [requestedScope as SearchKind];
  const requestedSort = normalize(operators.sort?.at(-1) || "relevance") as SearchSort;
  const sort: SearchSort = ["recent", "oldest", "title", "due", "priority"].includes(requestedSort) ? requestedSort : "relevance";
  return { term, operators, kinds, sort };
}

function boundedEditDistance(left: string, right: string, maximum: number) {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previousPrevious: number[] | null = null;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowMinimum = row;
    for (let column = 1; column <= right.length; column += 1) {
      let next = Math.min(
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
        current[column - 1] + 1,
        previous[column] + 1,
      );
      if (previousPrevious && row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
        next = Math.min(next, previousPrevious[column - 2] + 1);
      }
      current.push(next);
      rowMinimum = Math.min(rowMinimum, next);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previousPrevious = previous;
    previous = current;
  }
  return previous[right.length];
}

function tokenScore(queryToken: string, candidate: string) {
  if (candidate === queryToken) return 62;
  if (candidate.startsWith(queryToken)) return 46;
  if (candidate.includes(queryToken)) return 30;
  if (queryToken.length >= 4 && candidate.length >= 4) {
    const maximum = queryToken.length >= 8 ? 2 : 1;
    const distance = boundedEditDistance(queryToken, candidate, maximum);
    if (distance <= maximum) return 24 - distance * 5;
  }
  return 0;
}


function bestTokenScore(queryToken: string, candidates: string[], fuzzyCache?: Map<string, number>) {
  let contains = 0;
  for (const candidate of candidates) {
    if (candidate === queryToken) return 62;
    if (candidate.startsWith(queryToken)) return 46;
    if (candidate.includes(queryToken)) contains = 30;
  }
  if (contains) return contains;
  if (queryToken.length < 4) return 0;
  const maximum = queryToken.length >= 8 ? 2 : 1;
  let best = 0;
  for (const candidate of candidates) {
    if (candidate.length < 4) continue;
    const cacheKey = `${queryToken}\u0000${candidate}`;
    let fuzzyScore = fuzzyCache?.get(cacheKey);
    if (fuzzyScore == null) {
      const distance = boundedEditDistance(queryToken, candidate, maximum);
      fuzzyScore = distance <= maximum ? 24 - distance * 5 : 0;
      if (fuzzyCache && fuzzyCache.size < 20_000) fuzzyCache.set(cacheKey, fuzzyScore);
    }
    if (fuzzyScore > 0) {
      best = Math.max(best, fuzzyScore);
      if (fuzzyScore >= 19) return best;
    }
  }
  return best;
}

function initialsScore(query: string, title: string) {
  if (!query || query.includes(" ") || query.length < 2 || query.length > 8) return 0;
  const initials = tokenize(title, 12).map((token) => token[0]).join("");
  if (initials === query) return 92;
  if (initials.startsWith(query)) return 66;
  return 0;
}

function orderedTokenBoost(queryTokens: string[], candidateTokens: string[]) {
  if (queryTokens.length < 2) return 0;
  let cursor = -1;
  let spanStart = -1;
  for (const queryToken of queryTokens) {
    const exactIndex = candidateTokens.findIndex((candidate, index) => index > cursor && candidate === queryToken);
    const nextIndex = exactIndex >= 0 ? exactIndex : candidateTokens.findIndex((candidate, index) => index > cursor && tokenScore(queryToken, candidate) > 0);
    if (nextIndex < 0) return 0;
    if (spanStart < 0) spanStart = nextIndex;
    cursor = nextIndex;
  }
  return Math.max(4, 24 - Math.max(0, cursor - spanStart + 1 - queryTokens.length) * 4);
}

function recencyBoost(updatedAt?: string | null) {
  const timestamp = updatedAt ? new Date(updatedAt).getTime() : 0;
  if (!timestamp) return 0;
  const days = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  if (days <= 1) return 14;
  if (days <= 7) return 9;
  if (days <= 30) return 4;
  return 0;
}

export function score(item: SearchIndexItem, query: string, fuzzyCache = new Map<string, number>()) {
  const normalizedQuery = normalize(query);
  const queryTokens = tokenize(normalizedQuery, 10);
  if (!queryTokens.length) return { value: 1 + recencyBoost(item.updatedAt), reason: "Filtered result" };
  let value = 0;
  let reason = "Fuzzy match";
  if (item.normalizedTitle === normalizedQuery) { value += 240; reason = "Exact title"; }
  else if (item.normalizedTitle.startsWith(normalizedQuery)) { value += 185; reason = "Title prefix"; }
  else if (item.normalizedTitle.includes(normalizedQuery)) { value += 135; reason = "Title match"; }
  else if (item.normalizedText.includes(normalizedQuery)) { value += 88; reason = "Phrase match"; }
  const initials = initialsScore(normalizedQuery, item.normalizedTitle);
  if (initials) { value += initials; if (reason === "Fuzzy match") reason = "Title initials"; }
  for (const queryToken of queryTokens) {
    const best = bestTokenScore(queryToken, item.tokens, fuzzyCache);
    if (!best) {
      if (initials > 0 && queryTokens.length === 1) continue;
      return { value: -1, reason: "" };
    }
    value += best;
  }
  value += orderedTokenBoost(queryTokens, item.tokens);
  if (item.relationshipTerms.length) {
    const relationshipText = normalize(item.relationshipTerms.join(" "));
    const relationshipTokens = tokenize(relationshipText, 40);
    const relationshipExact = relationshipText.includes(normalizedQuery);
    const relationshipTokenHits = queryTokens.filter((token) => relationshipTokens.some((candidate) => candidate === token || candidate.startsWith(token))).length;
    if (relationshipExact || relationshipTokenHits === queryTokens.length) {
      value += relationshipExact ? 34 : 20;
      if (!["Exact title", "Title prefix", "Title match", "Phrase match"].includes(reason)) reason = "Linked work";
    }
  }
  if (item.kind === "person") value += 8;
  value += recencyBoost(item.updatedAt);
  return { value: Math.round(value), reason };
}


function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function parseDateWindow(value: string): DateWindow | null {
  const normalized = normalize(value);
  const now = new Date();
  const today = startOfDay(now);
  const dayMs = 86_400_000;
  if (normalized === "today") return { start: today, end: today + dayMs - 1 };
  if (normalized === "tomorrow") return { start: today + dayMs, end: today + 2 * dayMs - 1 };
  if (normalized === "yesterday") return { start: today - dayMs, end: today - 1 };
  const weekStart = today - ((now.getDay() + 6) % 7) * dayMs;
  if (normalized === "thisweek" || normalized === "week") return { start: weekStart, end: weekStart + 7 * dayMs - 1 };
  if (normalized === "nextweek") return { start: weekStart + 7 * dayMs, end: weekStart + 14 * dayMs - 1 };
  if (normalized === "lastweek") return { start: weekStart - 7 * dayMs, end: weekStart - 1 };
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  if (normalized === "thismonth" || normalized === "month") return { start: monthStart, end: nextMonth - 1 };
  if (normalized === "nextmonth") return { start: nextMonth, end: new Date(now.getFullYear(), now.getMonth() + 2, 1).getTime() - 1 };
  if (normalized === "lastmonth") return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(), end: monthStart - 1 };
  const relative = normalized.match(/^([+-]?)(\d+)([dhwm])$/);
  if (relative) {
    const direction = relative[1];
    const amount = Number(relative[2]);
    const unit = relative[3];
    const milliseconds = unit === "h" ? 3_600_000 : unit === "d" ? dayMs : unit === "w" ? 7 * dayMs : 30 * dayMs;
    return direction === "+"
      ? { start: Date.now(), end: Date.now() + amount * milliseconds }
      : { start: Date.now() - amount * milliseconds, end: Date.now() };
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const start = startOfDay(parsed);
  return { start, end: start + dayMs - 1 };
}

function facetMatches(item: SearchIndexItem, key: string, values: string[], exact = false) {
  const candidates = item.facets[key] || [];
  return values.some((value) => {
    const needle = normalize(value);
    return candidates.some((candidate) => exact ? normalize(candidate) === needle : normalize(candidate).includes(needle));
  });
}

function personFacetMatches(item: SearchIndexItem, key: "assignee" | "member" | "watcher" | "author", values: string[], currentUserId: string) {
  const ids = key === "assignee" ? unique([item.assigneeId, item.ownerId]) : key === "member" ? item.memberIds : key === "watcher" ? item.watcherIds : item.authorIds;
  return values.some((value) => {
    const normalized = normalize(value);
    if (["me", "myself", "current"].includes(normalized)) return ids.includes(currentUserId);
    return facetMatches(item, key, [value]);
  });
}

function hasFlag(item: SearchIndexItem, value: string) {
  const normalized = normalize(value).replace(/\s+/g, "-");
  if (normalized === "assignee") return Boolean(item.assigneeId || item.ownerId);
  if (normalized === "members" || normalized === "member") return item.memberIds.length > 0;
  if (normalized === "watchers" || normalized === "watcher") return item.watcherIds.length > 0;
  if (normalized === "labels" || normalized === "label") return item.labels.length > 0;
  if (normalized === "category") return item.categories.length > 0;
  if (normalized === "due") return Boolean(item.dueDate);
  if (normalized === "start") return Boolean(item.startDate);
  if (normalized === "project") return Boolean(item.projectId);
  if (normalized === "linked" || normalized === "relationship") return Boolean(item.relationshipSummary?.total);
  return item.flags.some((flag) => normalize(flag).replace(/\s+/g, "-") === normalized);
}

function inWindow(value: string | null | undefined, window: DateWindow | null) {
  if (!value || !window) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= window.start && timestamp <= window.end;
}

export function operatorMatches(item: SearchIndexItem, parsed: ParsedQuery, currentUserId: string) {
  const values = parsed.operators;
  if (parsed.kinds.length && !parsed.kinds.includes(item.kind)) return false;
  for (const key of ["project", "board", "list", "status", "department", "team", "role", "skill", "manager", "location", "timezone", "presence", "account", "label", "category", "source", "relationship", "mime", "ext", "id"] as const) {
    if (values[key]?.length && !facetMatches(item, key, values[key], key === "presence" || key === "ext")) return false;
  }
  if (values.priority?.length && !facetMatches(item, "priority", values.priority, true)) return false;
  for (const key of ["assignee", "member", "watcher", "author"] as const) {
    if (values[key]?.length && !personFacetMatches(item, key, values[key], currentUserId)) return false;
  }
  if (values.has?.some((value) => !hasFlag(item, value))) return false;
  if (values.missing?.some((value) => hasFlag(item, value))) return false;

  for (const value of values.is || []) {
    const normalized = normalize(value).replace(/\s+/g, "-");
    const dueAt = item.dueDate ? new Date(item.dueDate).getTime() : 0;
    if (normalized === "overdue" && !(dueAt && dueAt < Date.now() && normalize(item.status) !== "done")) return false;
    if (normalized === "due-today" && !inWindow(item.dueDate, parseDateWindow("today"))) return false;
    if (normalized === "due-soon" && !inWindow(item.dueDate, parseDateWindow("+7d"))) return false;
    if (normalized === "unassigned" && (item.assigneeId || item.ownerId)) return false;
    if (normalized === "assigned" && !(item.assigneeId || item.ownerId)) return false;
    if (normalized === "mine" && !unique([item.assigneeId, item.ownerId, ...item.memberIds, ...item.watcherIds, ...item.authorIds]).includes(currentUserId)) return false;
    if (normalized === "member" && !item.memberIds.includes(currentUserId)) return false;
    if (normalized === "watched" && !item.watcherIds.includes(currentUserId)) return false;
    if (normalized === "done" && !["done", "closed", "complete", "completed", "resolved"].includes(normalize(item.status))) return false;
    if (normalized === "open" && ["done", "archived", "closed", "complete", "completed", "resolved"].includes(normalize(item.status))) return false;
    if (normalized === "archived" && !hasFlag(item, "archived")) return false;
    if (normalized === "active" && hasFlag(item, "archived")) return false;
    if (normalized === "online" && !(item.kind === "person" && normalize(item.presence) !== "offline")) return false;
    if (normalized === "offline" && !(item.kind === "person" && normalize(item.presence) === "offline")) return false;
    if (normalized === "recent" && !inWindow(item.updatedAt, parseDateWindow("7d"))) return false;
    if (normalized === "stale" && inWindow(item.updatedAt, parseDateWindow("30d"))) return false;
    if (normalized === "blocked" && !(item.relationshipSummary?.blockers || normalize(`${item.status || ""} ${item.priority || ""} ${item.text}`).includes("block"))) return false;
  }

  const updatedAt = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
  const createdAt = item.createdAt ? new Date(item.createdAt).getTime() : 0;
  if (values.before?.length) {
    const window = parseDateWindow(values.before.at(-1) || "");
    if (!window || !updatedAt || updatedAt > window.end) return false;
  }
  if (values.after?.length) {
    const window = parseDateWindow(values.after.at(-1) || "");
    if (!window || !updatedAt || updatedAt < window.start) return false;
  }
  if (values.updated?.length && !inWindow(item.updatedAt, parseDateWindow(values.updated.at(-1) || ""))) return false;
  if (values.created?.length && !inWindow(item.createdAt, parseDateWindow(values.created.at(-1) || ""))) return false;
  if (values.due?.length) {
    const value = normalize(values.due.at(-1) || "");
    if (value === "none") { if (item.dueDate) return false; }
    else if (value === "overdue") { if (!item.dueDate || new Date(item.dueDate).getTime() >= Date.now() || normalize(item.status) === "done") return false; }
    else if (!inWindow(item.dueDate, parseDateWindow(value))) return false;
  }
  if (values.start?.length && !inWindow(item.startDate, parseDateWindow(values.start.at(-1) || ""))) return false;
  if (values.end?.length && !inWindow(item.endDate || item.dueDate, parseDateWindow(values.end.at(-1) || ""))) return false;
  return true;
}

function fuzzyPosting(snapshot: SearchIndexSnapshot, token: string) {
  if (token.length < 4) return null;
  const bigrams = [...new Set(Array.from({ length: token.length - 1 }, (_, index) => token.slice(index, index + 2)))];
  const counts = new Map<number, number>();
  let available = 0;
  for (const bigram of bigrams) {
    const posting = snapshot.postings.get(`~${bigram}`);
    if (!posting) continue;
    available += 1;
    for (const index of posting) counts.set(index, (counts.get(index) || 0) + 1);
  }
  if (!available) return null;
  const tolerance = token.length >= 8 ? 4 : 3;
  const minimum = Math.max(1, bigrams.length - tolerance);
  const matches = new Set([...counts.entries()].filter(([, count]) => count >= minimum).map(([index]) => index));
  return matches.size ? matches : null;
}

export function candidateIndexes(snapshot: SearchIndexSnapshot, term: string) {
  const queryTokens = tokenize(term, 8);
  if (!queryTokens.length) return snapshot.items.map((_, index) => index);
  const postings = queryTokens
    .map((token) => snapshot.postings.get(token) || snapshot.postings.get(token.slice(0, Math.min(8, token.length))) || fuzzyPosting(snapshot, token))
    .filter((value): value is Set<number> => Boolean(value))
    .sort((left, right) => left.size - right.size);
  if (postings.length !== queryTokens.length || !postings.length) return snapshot.items.map((_, index) => index);
  const [smallest, ...rest] = postings;
  return [...smallest].filter((index) => rest.every((posting) => posting.has(index)));
}

