import type { ReactNode } from "react";
import { ClusterStatus, type ClusterStatusTone } from "./ClusterStatus";

export function ClusterCountBadge({ count, label, tone = "neutral", max = 999 }: { count: number; label: string; tone?: ClusterStatusTone; max?: number }) {
  const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const visible = safe > max ? `${max}+` : String(safe);
  return <ClusterStatus compact tone={tone} aria-label={`${label}: ${safe}`}>{visible}</ClusterStatus>;
}

export function ClusterTag({ children, tone = "neutral", title }: { children: ReactNode; tone?: ClusterStatusTone; title?: string }) {
  return <ClusterStatus compact tone={tone} title={title}>{children}</ClusterStatus>;
}

export function ClusterHealthIndicator({ children, tone = "neutral", compact = true }: { children: ReactNode; tone?: ClusterStatusTone; compact?: boolean }) {
  return <ClusterStatus tone={tone} compact={compact} dot>{children}</ClusterStatus>;
}
