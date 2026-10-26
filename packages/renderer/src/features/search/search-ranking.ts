import { readPreferenceStorage, writePreferenceStorage } from "../../core/privacy-consent";
import { CLUSTER_SEARCH_SCOPE_IDS, CLUSTER_SEARCH_SCOPE_MANIFEST, COMMAND_SEARCH_KNOWN_OPERATORS, COMMAND_SEARCH_OPERATOR_ALIASES, type ClusterSearchScope } from "@cluster/shared";
import type { CommandSearchResultKind } from "../application/application-models";

export type SearchScope = ClusterSearchScope;

export type SearchDocument = {
  id: string;
  kind: CommandSearchResultKind | "action" | "page";
  title: string;
  detail?: string | null;
  keywords?: string[];
  updatedAt?: string | null;
  contextBoost?: number;
  usageBoost?: number;
};

export type SearchUsageContext = {
  screen?: string | null;
  projectId?: string | null;
};

const SCOPE_ALIASES: Record<string, SearchScope> = Object.fromEntries(
  CLUSTER_SEARCH_SCOPE_IDS.flatMap((scope) => CLUSTER_SEARCH_SCOPE_MANIFEST[scope].aliases.map((alias) => [alias, scope] as const)),
);

export function normalizeSearchText(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_/\\|.,:;!?()[\]{}<>"'`~@#$%^&*+=-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSearch(value: string) {
  return normalizeSearchText(value).split(" ").filter(Boolean).slice(0, 8);
}

export function parseScopedSearch(value: string): { scope: SearchScope; term: string; expression: string; explicit: boolean; operators: Record<string, string[]> } {
  const trimmed = value.trim();
  const match = value.trimStart().match(/^([a-z]+):\s+(.*)$/i);
  const matchedScope = match ? SCOPE_ALIASES[match[1].toLowerCase()] : undefined;
  const scope = matchedScope || "all";
  const expression = (matchedScope ? match?.[2] || "" : trimmed).trim();
  const operators: Record<string, string[]> = {};
  const term = expression.replace(/(?:^|\s)([a-z][\w-]*):(?:"([^"]+)"|'([^']+)'|([^\s]+))/gi, (operatorMatch, rawKey: string, quotedDouble: string, quotedSingle: string, unquoted: string) => {
    const key = COMMAND_SEARCH_OPERATOR_ALIASES[rawKey.toLowerCase()] || rawKey.toLowerCase();
    if (!COMMAND_SEARCH_KNOWN_OPERATORS.has(key)) return operatorMatch;
    const operatorValue = String(quotedDouble || quotedSingle || unquoted || "").trim();
    if (operatorValue) (operators[key] ||= []).push(operatorValue);
    return " ";
  }).replace(/\s+/g, " ").trim();
  return { scope, term, expression, explicit: Boolean(matchedScope), operators };
}

function boundedEditDistance(left: string, right: string, maximum: number) {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previousPrevious: number[] | null = null;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowMinimum = row;
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1);
      const insertion = current[column - 1] + 1;
      const deletion = previous[column] + 1;
      let next = Math.min(substitution, insertion, deletion);
      if (
        previousPrevious
        && row > 1
        && column > 1
        && left[row - 1] === right[column - 2]
        && left[row - 2] === right[column - 1]
      ) next = Math.min(next, previousPrevious[column - 2] + 1);
      current.push(next);
      rowMinimum = Math.min(rowMinimum, next);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previousPrevious = previous;
    previous = current;
  }
  return previous[right.length];
}

function subsequenceScore(needle: string, haystack: string) {
  if (!needle || !haystack || needle.length > haystack.length) return 0;
  let cursor = 0;
  let streak = 0;
  let bestStreak = 0;
  for (const character of haystack) {
    if (character === needle[cursor]) {
      cursor += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
      if (cursor === needle.length) return 18 + bestStreak * 2 - Math.max(0, haystack.length - needle.length) * 0.15;
    } else {
      streak = 0;
    }
  }
  return 0;
}

function tokenScore(queryToken: string, candidateToken: string) {
  if (candidateToken === queryToken) return 58;
  if (candidateToken.startsWith(queryToken)) return 44;
  if (candidateToken.includes(queryToken)) return 30;
  if (queryToken.length >= 4 && candidateToken.length >= 4) {
    const maximum = queryToken.length >= 8 ? 2 : 1;
    const distance = boundedEditDistance(queryToken, candidateToken, maximum);
    if (distance <= maximum) return 24 - distance * 6;
  }
  return subsequenceScore(queryToken, candidateToken);
}


function initialsScore(query: string, title: string) {
  if (!query || query.includes(" ") || query.length < 2 || query.length > 8) return 0;
  const initials = tokenizeSearch(title).map((token) => token[0]).join("");
  if (!initials) return 0;
  if (initials === query) return 88;
  if (initials.startsWith(query)) return 62;
  return 0;
}

function orderedTokenBoost(queryTokens: string[], candidateTokens: string[]) {
  if (queryTokens.length < 2) return 0;
  let cursor = -1;
  let spanStart = -1;
  for (const queryToken of queryTokens) {
    const nextIndex = candidateTokens.findIndex((candidate, index) => index > cursor && tokenScore(queryToken, candidate) > 0);
    if (nextIndex < 0) return 0;
    if (spanStart < 0) spanStart = nextIndex;
    cursor = nextIndex;
  }
  const span = cursor - spanStart + 1;
  return Math.max(4, 24 - Math.max(0, span - queryTokens.length) * 4);
}

function recencyBoost(updatedAt?: string | null) {
  if (!updatedAt) return 0;
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const days = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  if (days <= 1) return 12;
  if (days <= 7) return 8;
  if (days <= 30) return 4;
  return 0;
}

export function scoreSearchDocument(document: SearchDocument, rawQuery: string) {
  const query = normalizeSearchText(rawQuery);
  if (!query) return 1 + (document.contextBoost || 0) + (document.usageBoost || 0) + recencyBoost(document.updatedAt);
  const title = normalizeSearchText(document.title);
  const detail = normalizeSearchText(document.detail || "");
  const keywords = normalizeSearchText((document.keywords || []).join(" "));
  const haystack = `${title} ${detail} ${keywords}`.trim();
  const queryTokens = tokenizeSearch(query);
  const candidateTokens = tokenizeSearch(haystack);
  if (!queryTokens.length || !candidateTokens.length) return -1;

  let score = 0;
  if (title === query) score += 220;
  else if (title.startsWith(query)) score += 170;
  else if (title.includes(query)) score += 120;
  else if (haystack.includes(query)) score += 82;
  const initials = initialsScore(query, title);
  score += initials;

  for (const queryToken of queryTokens) {
    let best = 0;
    for (const candidateToken of candidateTokens) best = Math.max(best, tokenScore(queryToken, candidateToken));
    if (best <= 0) {
      if (initials > 0 && queryTokens.length === 1) continue;
      return -1;
    }
    score += best;
  }

  const titleTokens = tokenizeSearch(title);
  const firstTitleToken = titleTokens[0];
  if (firstTitleToken && firstTitleToken.startsWith(queryTokens[0])) score += 18;
  score += orderedTokenBoost(queryTokens, candidateTokens);
  score += document.contextBoost || 0;
  score += document.usageBoost || 0;
  score += recencyBoost(document.updatedAt);
  return Math.round(score);
}

export type SearchUsageRecord = {
  count: number;
  lastUsedAt: string;
  screens?: Record<string, number>;
  projects?: Record<string, number>;
};
export type SearchUsageMap = Record<string, SearchUsageRecord>;

export function readSearchUsage(userId: string): SearchUsageMap {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(readPreferenceStorage(`cluster-search-usage-${userId}-v294`) || "{}");
    return parsed && typeof parsed === "object" ? (parsed as SearchUsageMap) : {};
  } catch {
    return {};
  }
}

function boundedContextCounts(current: Record<string, number> | undefined, value?: string | null) {
  if (!value) return current;
  const next = { ...(current || {}), [value]: Math.min(500, (current?.[value] || 0) + 1) };
  return Object.fromEntries(Object.entries(next).sort(([, left], [, right]) => right - left).slice(0, 12));
}

export function searchUsageBoost(usage: SearchUsageMap, key: string, context?: SearchUsageContext) {
  const record = usage[key];
  if (!record) return 0;
  const ageDays = Math.max(0, (Date.now() - new Date(record.lastUsedAt).getTime()) / 86_400_000);
  const recency = ageDays <= 1 ? 18 : ageDays <= 7 ? 12 : ageDays <= 30 ? 6 : 0;
  const frequency = Math.min(24, Math.log2(record.count + 1) * 5);
  const screenCount = context?.screen ? record.screens?.[context.screen] || 0 : 0;
  const projectCount = context?.projectId ? record.projects?.[context.projectId] || 0 : 0;
  const contextual = Math.min(18, Math.log2(screenCount + 1) * 4 + Math.log2(projectCount + 1) * 5);
  return frequency + recency + contextual;
}

export function recordSearchUsage(userId: string, key: string, context?: SearchUsageContext) {
  if (typeof window === "undefined") return;
  const usage = readSearchUsage(userId);
  const previous = usage[key];
  usage[key] = {
    count: Math.min(10_000, (previous?.count || 0) + 1),
    lastUsedAt: new Date().toISOString(),
    screens: boundedContextCounts(previous?.screens, context?.screen),
    projects: boundedContextCounts(previous?.projects, context?.projectId),
  };
  const trimmed = Object.fromEntries(
    Object.entries(usage)
      .sort(([, a], [, b]) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime())
      .slice(0, 120),
  );
  writePreferenceStorage(`cluster-search-usage-${userId}-v294`, JSON.stringify(trimmed));
}

export function searchKindLabel(kind: SearchDocument["kind"]) {
  if (kind === "person") return "Person";
  if (kind === "source_review") return "Source review";
  if (kind === "source_commit") return "Source commit";
  if (kind === "studio_form") return "Studio form";
  if (kind === "form_submission") return "Form review";
  if (kind === "approval") return "Approval";
  if (kind === "whiteboard") return "Whiteboard";
  if (kind === "file") return "Library";
  if (kind === "action") return "Action";
  if (kind === "page") return "Page";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
