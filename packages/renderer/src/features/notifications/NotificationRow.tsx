import { localizeTimestamps } from "../../core/date-time";
import type { ReactNode } from "react";
import type { NotificationCategory, NotificationItem } from "@cluster/shared";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";
import { formatRelativeTime } from "../../core/format";
import "./notify.css";

/* One notification, the same everywhere it appears (bell popover, Inbox).
   The icon says what kind; its tint says how urgent; a dot says unread.
   Words: title, one line of message, where it came from, when. */

const CATEGORY_ICON: Record<NotificationCategory, ClusterIconName> = {
  mentions: "comment", approvals: "check", work: "work", schedule: "calendar", delivery: "cloud", qa: "check", system: "warning", activity: "activity",
};
export function notificationCategoryIcon(category: string): ClusterIconName {
  return CATEGORY_ICON[category as NotificationCategory] || "bell";
}
export function notificationTone(priority: NotificationItem["priority"]): "danger" | "warning" | "neutral" {
  return priority === "critical" ? "danger" : priority === "high" ? "warning" : "neutral";
}

export function NotificationRow({ item, selected = false, compact = false, leading, onOpen }: {
  item: NotificationItem;
  selected?: boolean;
  compact?: boolean;
  leading?: ReactNode;
  onOpen: () => void;
}) {
  const source = [item.projectName, item.actor].filter(Boolean).join(" · ");
  const needsAction = Boolean(item.requiresAction && !item.acknowledgedAt);
  return <div className="nt-row" data-unread={!item.read || undefined} data-tone={notificationTone(item.priority)} data-selected={selected || undefined} data-compact={compact || undefined}>
    {leading ? <span className="nt-row__lead">{leading}</span> : null}
    <ClusterButton unstyled type="button" className="nt-row__main" onClick={onOpen} aria-current={selected || undefined}>
      <span className="nt-icon" data-category={item.category} aria-hidden="true"><ClusterIcon name={notificationCategoryIcon(item.category)} /></span>
      <span className="nt-row__copy">
        <strong>{item.title}</strong>
        {item.message ? <span>{localizeTimestamps(item.message)}</span> : null}
        {source && !compact ? <small>{source}</small> : null}
      </span>
      <span className="nt-row__side">
        <time dateTime={item.createdAt}>{formatRelativeTime(item.createdAt)}</time>
        {needsAction ? <em className="nt-flag">Action</em> : item.priority === "critical" ? <em className="nt-flag" data-tone="danger">Critical</em> : null}
      </span>
      {!item.read ? <i className="nt-unread" aria-label="Unread" /> : null}
    </ClusterButton>
  </div>;
}
