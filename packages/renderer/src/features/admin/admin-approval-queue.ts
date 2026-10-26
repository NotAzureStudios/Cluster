export type ApprovalItem = {
  id: string;
  type: string;
  title: string;
  status: string;
  projectId?: string | null;
  requestedByName?: string | null;
  reason?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  createdAt: string;
  payload?: Record<string, any>;
};


type ApprovalPriority = "urgent" | "high" | "normal" | "low";
export type ApprovalSort = "priority" | "oldest" | "newest";


export function ageDays(item: ApprovalItem) {
  return Math.max(0, Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 86400000));
}

export function approvalPriority(item: ApprovalItem): ApprovalPriority {
  const explicit = String(item.payload?.priority || "").toLowerCase();
  if (["urgent", "high", "normal", "low"].includes(explicit)) return explicit as ApprovalPriority;
  if (item.type === "external_release") return "urgent";
  if (item.type === "project_completion") return "high";
  if (item.type === "time_off" && item.startsAt && new Date(item.startsAt).getTime() - Date.now() < 3 * 86400000) return "high";
  if (ageDays(item) >= 5) return "high";
  if (item.type === "avatar_change") return "low";
  return "normal";
}

const APPROVAL_ORDER: Record<ApprovalPriority, number> = { urgent: 4, high: 3, normal: 2, low: 1 };
export function sortApprovalQueue<T extends ApprovalItem>(items: readonly T[], sort: ApprovalSort): T[] {
  return [...items].sort((a, b) => {
    // Pending work must remain ahead of resolved history when a mixed view is used.
    if ((a.status === "pending") !== (b.status === "pending")) return a.status === "pending" ? -1 : 1;
    if (sort === "priority" && a.status === "pending" && b.status === "pending") {
      const weight = APPROVAL_ORDER[approvalPriority(b)] - APPROVAL_ORDER[approvalPriority(a)];
      if (weight) return weight;
    }
    const left = Date.parse(a.createdAt) || 0;
    const right = Date.parse(b.createdAt) || 0;
    const byDate = sort === "newest" || (sort === "priority" && a.status !== "pending") ? right - left : left - right;
    return byDate || a.id.localeCompare(b.id);
  });
}

