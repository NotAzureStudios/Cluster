import type { EntityLifecycleStatus, EntityVisibility, User } from "./identity";
import type { Priority, Project } from "./projects";

export type GitLabel = {
  id?: number;
  name: string;
  color?: string | null;
  description?: string | null;
};

export type GitTag = { name: string; commit?: unknown };

export type GitIssue = {
  id?: number;
  number: number;
  title: string;
  state: string;
  body?: string;
  url?: string | null;
  labels: GitLabel[];
  assignee?: string | null;
  milestone?: string | null;
  deadline?: string | null;
  comments?: number;
  updatedAt?: string | null;
  createdAt?: string | null;
};

export type LibraryType = "note" | "decision" | "spec" | "link" | "meeting" | "reference" | "folder";

export type LibraryStatus = EntityLifecycleStatus | "needs-review";

export type LibraryItem = {
  id: string;
  projectId?: string | null;
  project?: Project | null;
  ownerId?: string | null;
  owner?: User | null;
  reviewerId?: string | null;
  reviewer?: User | null;
  title: string;
  body?: string | null;
  type: LibraryType | string;
  status: LibraryStatus | string;
  priority: Priority | string;
  tags: string[];
  externalUrl?: string | null;
  pinned?: boolean;
  versionLabel?: string | null;
  reviewDueAt?: string | null;
  approvedAt?: string | null;
  visibility?: EntityVisibility | string | null;
  lifecycleNotes?: string | null;
  changelog?:
    | Array<{
        at: string;
        by?: string | null;
        from?: string | null;
        to?: string | null;
        note?: string | null;
      }>
    | string
    | null;
  createdAt: string;
  updatedAt: string;
};

export type LibrarySummary = {
  total: number;
  pinned: number;
  recent: LibraryItem[];
  byType: Record<string, number>;
  byStatus: Record<string, number>;
};
