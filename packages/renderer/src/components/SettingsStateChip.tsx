import type { ReactNode } from "react";
import { ClusterIcon, type ClusterIconName } from "./ClusterIcon";
import "./settings-state-chip.css";

export type SettingsStateTone = "neutral" | "info" | "success" | "warning" | "danger";

const DEFAULT_ICONS: Record<SettingsStateTone, ClusterIconName> = {
  neutral: "minus",
  info: "activity",
  success: "check",
  warning: "warning",
  danger: "warning",
};

/** Reusable, semantic status indicator for Admin, Studio and Server settings.
 * Tone is supplied by authoritative state; never colorize an unverified claim.
 * Always pair the icon/color with visible text for keyboard and low-vision users. */
export function SettingsStateChip({
  tone = "neutral",
  icon,
  children,
  className = "",
}: {
  tone?: SettingsStateTone;
  icon?: ClusterIconName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`settings-state-chip-v103 tone-${tone} ${className}`.trim()}>
      <ClusterIcon name={icon || DEFAULT_ICONS[tone]} treatment="action" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
