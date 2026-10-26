type SearchWorkerDocument = {
  key: string;
  title: string;
  detail: string;
  text?: string;
  kind: string;
  updatedAt?: string | null;
};

type IndexedDocument = SearchWorkerDocument & {
  titleNormalized: string;
  textNormalized: string;
  tokens: string[];
};

type WorkerRequest =
  | { type: "index"; version: number; documents: SearchWorkerDocument[] }
  | { type: "search"; requestId: number; version: number; query: string; limit: number };

let indexedVersion = 0;
let documents: IndexedDocument[] = [];
let postings = new Map<string, Set<number>>();

function normalize(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_/\\|.,:;!?()[\]{}<>"'`~@#$%^&*+=-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string, limit = 40) {
  return normalize(value).split(" ").filter(Boolean).slice(0, limit);
}

function indexDocuments(version: number, input: SearchWorkerDocument[]) {
  indexedVersion = version;
  documents = input.map((document) => {
    const titleNormalized = normalize(document.title);
    const textNormalized = normalize(`${document.title} ${document.detail} ${document.text || ""} ${document.kind}`);
    return { ...document, titleNormalized, textNormalized, tokens: [...new Set(tokenize(textNormalized))] };
  });
  postings = new Map();
  documents.forEach((document, index) => {
    document.tokens.forEach((token) => {
      const keys = new Set<string>();
      for (let length = 2; length <= Math.min(8, token.length); length += 1) keys.add(token.slice(0, length));
      if (token.length >= 4) for (let offset = 0; offset < token.length - 1; offset += 1) keys.add(`~${token.slice(offset, offset + 2)}`);
      for (const key of keys) {
        const posting = postings.get(key) || new Set<number>();
        posting.add(index);
        postings.set(key, posting);
      }
    });
  });
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
  if (candidate === queryToken) return 58;
  if (candidate.startsWith(queryToken)) return 44;
  if (candidate.includes(queryToken)) return 28;
  if (queryToken.length >= 4 && candidate.length >= 4) {
    const maximum = queryToken.length >= 8 ? 2 : 1;
    const distance = boundedEditDistance(queryToken, candidate, maximum);
    if (distance <= maximum) return 24 - distance * 6;
  }
  return 0;
}

function bestTokenScore(queryToken: string, candidates: string[], fuzzyCache?: Map<string, number>) {
  let contains = 0;
  for (const candidate of candidates) {
    if (candidate === queryToken) return 58;
    if (candidate.startsWith(queryToken)) return 44;
    if (candidate.includes(queryToken)) contains = 28;
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
      fuzzyScore = distance <= maximum ? 24 - distance * 6 : 0;
      if (fuzzyCache && fuzzyCache.size < 20_000) fuzzyCache.set(cacheKey, fuzzyScore);
    }
    if (fuzzyScore > 0) {
      best = Math.max(best, fuzzyScore);
      if (fuzzyScore >= 18) return best;
    }
  }
  return best;
}

function initialsScore(query: string, title: string) {
  if (!query || query.includes(" ") || query.length < 2 || query.length > 8) return 0;
  const initials = tokenize(title, 12).map((token) => token[0]).join("");
  if (initials === query) return 88;
  if (initials.startsWith(query)) return 62;
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

function recency(updatedAt?: string | null) {
  const timestamp = updatedAt ? new Date(updatedAt).getTime() : 0;
  if (!timestamp) return 0;
  const days = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  return days <= 1 ? 12 : days <= 7 ? 8 : days <= 30 ? 4 : 0;
}

function score(document: IndexedDocument, query: string, fuzzyCache: Map<string, number>) {
  if (!query) return 1 + recency(document.updatedAt);
  const queryTokens = tokenize(query, 8);
  let value = 0;
  if (document.titleNormalized === query) value += 220;
  else if (document.titleNormalized.startsWith(query)) value += 170;
  else if (document.titleNormalized.includes(query)) value += 120;
  else if (document.textNormalized.includes(query)) value += 80;
  const initials = initialsScore(query, document.titleNormalized);
  value += initials;
  for (const queryToken of queryTokens) {
    const best = bestTokenScore(queryToken, document.tokens, fuzzyCache);
    if (!best) {
      if (initials > 0 && queryTokens.length === 1) continue;
      return -1;
    }
    value += best;
  }
  value += orderedTokenBoost(queryTokens, document.tokens);
  return value + recency(document.updatedAt);
}

function fuzzyPosting(token: string) {
  if (token.length < 4) return null;
  const bigrams = [...new Set(Array.from({ length: token.length - 1 }, (_, index) => token.slice(index, index + 2)))];
  const counts = new Map<number, number>();
  let available = 0;
  for (const bigram of bigrams) {
    const posting = postings.get(`~${bigram}`);
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

function candidateIndexes(query: string) {
  const queryTokens = tokenize(query, 8);
  if (!queryTokens.length) return documents.map((_, index) => index);
  const sets = queryTokens.map((token) => postings.get(token.slice(0, Math.min(8, token.length))) || fuzzyPosting(token)).filter((set): set is Set<number> => Boolean(set));
  if (sets.length !== queryTokens.length) return documents.map((_, index) => index);
  sets.sort((left, right) => left.size - right.size);
  return [...sets[0]].filter((index) => sets.slice(1).every((set) => set.has(index)));
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "index") {
    indexDocuments(message.version, message.documents);
    self.postMessage({ type: "indexed", version: indexedVersion, count: documents.length });
    return;
  }
  if (message.version !== indexedVersion) {
    self.postMessage({ type: "stale", requestId: message.requestId, requestedVersion: message.version, indexedVersion });
    return;
  }
  const startedAt = performance.now();
  const query = normalize(message.query);
  const candidates = candidateIndexes(query);
  const fuzzyCache = new Map<string, number>();
  const scores = candidates
    .map((index) => ({ key: documents[index].key, score: score(documents[index], query, fuzzyCache) }))
    .filter((row) => row.score >= 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, message.limit);
  self.postMessage({
    type: "results",
    requestId: message.requestId,
    version: indexedVersion,
    scores,
    candidateCount: candidates.length,
    elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
  });
};
