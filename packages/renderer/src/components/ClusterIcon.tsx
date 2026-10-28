import { Icon } from "@iconify/react";
import type { CSSProperties } from "react";
import generatedIcons from "./icon-catalog.generated.json";

/**
 * RC16: the only production icon boundary. Workspaces request semantic icons,
 * not vendor names. All glyphs are curated OFFLINE from three licensed packs
 * by `npm run icons:generate` before the renderer is type-checked/bundled.
 * Missing glyphs fail at build time instead of hiding behind Coolicons.
 */
export type ClusterIconName =
  | "activity"
  | "archive"
  | "audio"
  | "bell"
  | "calendar"
  | "check"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "chevron-up"
  | "clock"
  | "close"
  | "cloud"
  | "cloud-off"
  | "code"
  | "comment"
  | "download"
  | "drag"
  | "file"
  | "folder"
  | "forward"
  | "fullscreen"
  | "game"
  | "grid"
  | "home"
  | "image"
  | "inventory"
  | "keyboard"
  | "library"
  | "link"
  | "list"
  | "lock"
  | "menu"
  | "minus"
  | "minimize"
  | "model"
  | "more"
  | "mute"
  | "next"
  | "note"
  | "operations"
  | "packet"
  | "pages"
  | "palette"
  | "panel-close"
  | "panel-open"
  | "pause"
  | "pdf"
  | "pin"
  | "play"
  | "playlist"
  | "plus"
  | "previous"
  | "print"
  | "project"
  | "refresh"
  | "reset"
  | "rewind"
  | "rotate"
  | "search"
  | "settings"
  | "spark"
  | "speed"
  | "star"
  | "star-filled"
  | "sync"
  | "text"
  | "ticket"
  | "timeline"
  | "tools"
  | "trash"
  | "upload"
  | "user"
  | "users"
  | "video"
  | "volume"
  | "warning"
  | "work"
  | "zoom-in"
  | "zoom-out";


export type ClusterIconTreatment = "duotone" | "navigation" | "action";
export type ClusterIconVisualProps = {
  className?: string;
  style?: CSSProperties;
  width?: string | number;
  height?: string | number;
  "aria-hidden"?: boolean | "true" | "false";
};
type OfflineGlyph = { body: string; width?: number; height?: number };
const offlineGlyphs: Readonly<Record<string, OfflineGlyph>> = generatedIcons as Record<string, OfflineGlyph>;
const packPriority: Readonly<Record<ClusterIconTreatment, readonly string[]>> = {
  duotone: ["ph", "tabler", "lucide"],
  navigation: ["tabler", "ph", "lucide"],
  action: ["lucide", "tabler", "ph"],
};

const identityNames = new Set<ClusterIconName>([
  "activity", "archive", "audio", "calendar", "cloud", "code", "folder", "game", "grid",
  "home", "image", "inventory", "library", "model", "note", "operations", "packet", "pages", "palette",
  "pdf", "project", "settings", "ticket", "timeline", "tools", "user", "users", "video", "work",
]);

/** A filled star must remain filled in toolbar buttons, not degrade to a line star. */
export function resolveIcon(name: ClusterIconName, treatment: ClusterIconTreatment = "action") {
  const priority = name === "star-filled" ? ["ph", "tabler", "lucide"] : packPriority[treatment];
  const pack = priority.find((candidate) => offlineGlyphs[`${candidate}:${name}`]);
  return pack ? { pack, icon: offlineGlyphs[`${pack}:${name}`] } : undefined;
}

export function ClusterIcon({name, treatment, className, style, width, height}: ClusterIconVisualProps & {name: ClusterIconName; treatment?: ClusterIconTreatment}) {
  const effectiveTreatment = treatment ?? (identityNames.has(name) ? "duotone" : "action");
  const result = resolveIcon(name,effectiveTreatment);
  // The release generator enforces complete coverage. A broken or unbuilt
  // catalog remains visibly diagnosable instead of rendering a random icon.
  const iconClassName = ["cluster-icon-svg", "cluster-icon--unified", `cluster-icon--${effectiveTreatment}`, className].filter(Boolean).join(" ");
  if (!result) return <span role="img" aria-label={`Missing icon: ${name}`} className={`${iconClassName} cluster-icon--missing`} />;
  return <Icon
    icon={result.icon}
    data-icon-pack={result.pack}
    data-icon-name={name}
    data-icon-treatment={effectiveTreatment}
    aria-hidden="true"
    focusable="false"
    className={iconClassName}
    style={style}
    width={width ?? "1em"}
    height={height ?? "1em"}
  />;
}
