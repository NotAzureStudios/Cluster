export type SmartWorkspaceContext = {
  screen: string;
  projectId?: string | null;
  boardId?: string | null;
  whiteboardId?: string | null;
  updatedAt: string;
};

export type SmartCreateMemory = {
  mode: string;
  projectId?: string | null;
  boardId?: string | null;
  assigneeId?: string | null;
  priority?: string | null;
  labelsText?: string | null;
  usedAt: string;
};

export type SmartSignalPreference = {
  dismissedAt?: string | null;
  snoozedUntil?: string | null;
};

export type SmartSignalPreferences = Record<string, SmartSignalPreference>;

export type DuplicateCandidate = {
  id: string;
  title: string;
  kind: "project" | "card" | "ticket" | "build" | "timeline" | "whiteboard" | string;
  subtitle?: string | null;
  projectId?: string | null;
  boardId?: string | null;
};

export type DuplicateMatch = DuplicateCandidate & {
  score: number;
  reason: "exact" | "near-exact" | "similar";
};

const MEANINGFUL_SCREENS = new Set([
  "mywork",
  "projects",
  "project",
  "board",
  "whiteboard",
  "tickets",
  "timeline",
  "calendar",
  "scheduler",
  "library",
  "packets",
  "inventory",
  "vault",
  "people",
  "activity",
  "admin",
]);

export function normalizeWorkTitle(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(value: string) {
  return new Set(
    normalizeWorkTitle(value)
      .split(" ")
      .filter((token) => token.length > 1 && !["a", "an", "the", "to", "for", "of", "and", "or", "in", "on"].includes(token)),
  );
}

function diceCoefficient(left: string, right: string) {
  const a = normalizeWorkTitle(left).replace(/\s+/g, "");
  const b = normalizeWorkTitle(right).replace(/\s+/g, "");
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let index = 0; index < a.length - 1; index += 1) {
    const pair = a.slice(index, index + 2);
    pairs.set(pair, (pairs.get(pair) || 0) + 1);
  }
  let overlap = 0;
  for (let index = 0; index < b.length - 1; index += 1) {
    const pair = b.slice(index, index + 2);
    const count = pairs.get(pair) || 0;
    if (!count) continue;
    overlap += 1;
    pairs.set(pair, count - 1);
  }
  return (2 * overlap) / (a.length + b.length - 2);
}

function tokenOverlap(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / new Set([...a, ...b]).size;
}

export function workTitleSimilarity(left: string, right: string) {
  const a = normalizeWorkTitle(left);
  const b = normalizeWorkTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  const containment = shorter.length >= 5 && longer.includes(shorter) ? Math.min(0.92, 0.72 + shorter.length / Math.max(longer.length, 1) * 0.2) : 0;
  const tokenScore = tokenOverlap(a, b);
  const characterScore = diceCoefficient(a, b);
  return Math.max(containment, tokenScore * 0.68 + characterScore * 0.32);
}

export function findLikelyDuplicates(title: string, candidates: DuplicateCandidate[], limit = 3): DuplicateMatch[] {
  const normalized = normalizeWorkTitle(title);
  if (normalized.length < 3) return [];
  return candidates
    .map((candidate) => {
      const score = workTitleSimilarity(normalized, candidate.title);
      const reason: DuplicateMatch["reason"] = score >= 0.995 ? "exact" : score >= 0.86 ? "near-exact" : "similar";
      return { ...candidate, score, reason };
    })
    .filter((candidate) => candidate.score >= 0.68)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, Math.max(1, limit));
}

export function isMeaningfulWorkspaceScreen(screen: string) {
  return MEANINGFUL_SCREENS.has(screen);
}

export function signalIsVisible(id: string, preferences: SmartSignalPreferences, now = Date.now()) {
  const preference = preferences[id];
  if (!preference) return true;
  if (preference.dismissedAt) return false;
  if (preference.snoozedUntil && new Date(preference.snoozedUntil).getTime() > now) return false;
  return true;
}

export function pruneSignalPreferences(preferences: SmartSignalPreferences, validIds: string[], now = Date.now()) {
  const valid = new Set(validIds);
  return Object.fromEntries(
    Object.entries(preferences).filter(([id, preference]) => {
      if (!valid.has(id)) return false;
      if (preference.dismissedAt && now - new Date(preference.dismissedAt).getTime() > 30 * 24 * 60 * 60 * 1000) return false;
      if (preference.snoozedUntil && new Date(preference.snoozedUntil).getTime() <= now) return false;
      return true;
    }),
  );
}
