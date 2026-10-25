import type { ClusterResourceAddress, ClusterSearchResultKind } from "@cluster/shared";
import type { SearchCorpus } from "./search-repository.js";

export type SearchKind = ClusterSearchResultKind;
export type SearchSort = "relevance" | "recent" | "oldest" | "title" | "due" | "priority";
export type SearchIndexItem = {
  id: string;
  kind: SearchKind;
  title: string;
  detail: string;
  text: string;
  normalizedTitle: string;
  normalizedText: string;
  tokens: string[];
  projectId?: string | null;
  projectName?: string | null;
  /** Project revision used to fence stale child titles and archived scopes. */
  projectUpdatedAt?: string | null;
  boardId?: string | null;
  boardName?: string | null;
  listName?: string | null;
  cardId?: string | null;
  whiteboardId?: string | null;
  resource?: ClusterResourceAddress | null;
  ownerId?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  memberIds: string[];
  watcherIds: string[];
  authorIds: string[];
  status?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  avatarUrl?: string | null;
  department?: string | null;
  teamName?: string | null;
  roleName?: string | null;
  presence?: string | null;
  location?: string | null;
  timezone?: string | null;
  labels: string[];
  categories: string[];
  flags: string[];
  aliases: string[];
  relationshipTerms: string[];
  facets: Record<string, string[]>;
  relationshipSummary?: { total: number; blockers: number; critical: number; labels: string[] };
  raw: any;
};

export type SearchIndexSnapshot = {
  loadedAt: number;
  corpus: SearchCorpus;
  items: SearchIndexItem[];
  postings: Map<string, Set<number>>;
};

export type ParsedQuery = {
  term: string;
  operators: Record<string, string[]>;
  kinds: SearchKind[];
  sort: SearchSort;
};

export type DateWindow = { start: number; end: number };
