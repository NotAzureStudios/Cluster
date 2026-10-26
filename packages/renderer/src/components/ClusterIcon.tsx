import { Icon } from "@iconify/react";
import { icons as coolicons } from "@iconify-json/ci";
import type { CSSProperties } from "react";

/**
 * Cluster's canonical icon boundary.
 *
 * The application owns semantic icon names; Coolicons owns the artwork. Keeping
 * the translation here lets product code describe intent without coupling every
 * feature to a third-party asset filename. The complete Coolicons collection is
 * bundled locally, so icons remain available in the offline desktop client without
 * registering or querying any remote icon provider.
 */

const availableCoolicons = new Set(
  Object.entries(coolicons.icons)
    .filter(([, icon]) => (icon as { hidden?: boolean }).hidden !== true)
    .map(([name]) => name),
);

export const COOLICON_NAMES = Object.freeze([...availableCoolicons].sort());
export type CoolIconName = string;

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

export const CLUSTER_COOLICON_MAP: Readonly<Record<ClusterIconName, string>> = {
  activity: "chart-line",
  archive: "archive",
  audio: "headphones",
  bell: "bell",
  calendar: "calendar",
  check: "check",
  "chevron-down": "chevron-down",
  "chevron-left": "chevron-left",
  "chevron-right": "chevron-right",
  "chevron-up": "chevron-up",
  clock: "clock",
  close: "close-md",
  cloud: "cloud",
  "cloud-off": "cloud-off",
  code: "file-code",
  comment: "chat-circle",
  download: "download",
  drag: "drag-vertical",
  file: "file-blank",
  folder: "folder",
  forward: "forward",
  fullscreen: "expand",
  game: "puzzle",
  grid: "more-grid-big",
  home: "house-01",
  image: "image-01",
  keyboard: "keyboard",
  library: "book-open",
  link: "link",
  list: "list-unordered",
  lock: "lock",
  menu: "hamburger-md",
  minus: "remove-minus",
  minimize: "shrink",
  model: "cylinder",
  more: "more-horizontal",
  mute: "volume-off",
  next: "skip-forward",
  note: "note",
  operations: "slider-03",
  packet: "files",
  pages: "files",
  palette: "swatches-palette",
  "panel-close": "bar-right",
  "panel-open": "bar-left",
  pause: "pause",
  pdf: "file-document",
  pin: "map-pin",
  play: "play",
  playlist: "list-add",
  plus: "add-plus",
  previous: "skip-back",
  print: "printer",
  project: "main-component",
  refresh: "arrows-reload-01",
  reset: "arrow-reload-02",
  rewind: "rewind",
  rotate: "arrow-reload-02",
  search: "search-magnifying-glass",
  settings: "settings",
  spark: "bulb",
  speed: "timer",
  star: "star",
  "star-filled": "star",
  sync: "arrows-reload-01",
  text: "file-document",
  ticket: "ticket-voucher",
  timeline: "list-ordered",
  tools: "settings-future",
  trash: "trash-empty",
  upload: "file-upload",
  user: "user-01",
  users: "users",
  video: "monitor-play",
  volume: "volume-max",
  warning: "triangle-warning",
  work: "suitcase",
  "zoom-in": "magnifying-glass-plus",
  "zoom-out": "magnifying-glass-minus",
};

function localCooliconName(name: string) {
  return availableCoolicons.has(name) ? name : "circle-warning";
}

type ClusterIconVisualProps = {
  className?: string;
  style?: CSSProperties;
  width?: string | number;
  height?: string | number;
  "aria-hidden"?: boolean | "true" | "false";
};

type CoolIconProps = ClusterIconVisualProps & { name: CoolIconName };

export function CoolIcon({ name, className, style, width, height }: CoolIconProps) {
  const resolved = localCooliconName(name);
  const iconClassName = ["cluster-icon-svg", className].filter(Boolean).join(" ");
  const artwork = coolicons.icons[resolved];
  return (
    <Icon
      icon={artwork}
      data-coolicon={resolved}
      aria-hidden="true"
      focusable="false"
      className={iconClassName}
      style={{ overflow: "visible", ...style }}
      width={width}
      height={height}
    />
  );
}

export function ClusterIcon({ name, className, style, width, height }: ClusterIconVisualProps & { name: ClusterIconName }) {
  const coolicon = CLUSTER_COOLICON_MAP[name];
  return <CoolIcon name={coolicon} className={className} style={style} width={width} height={height} />;
}
