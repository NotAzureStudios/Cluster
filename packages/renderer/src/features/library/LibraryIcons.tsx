import type { CSSProperties } from "react";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";
import type { LibraryItem } from "./library-types";
import { ResourceIdentityMark } from "../../components/ResourceIdentityMark";

type IconName = "folder" | "file" | "text" | "image" | "video" | "audio" | "pdf" | "archive" | "model" | "link" | "note" | "code" | "game" | "star" | "palette" | "search" | "grid" | "list" | "close" | "play" | "pause" | "volume" | "mute" | "fullscreen" | "reset" | "previous" | "next" | "rewind" | "forward" | "speed" | "keyboard" | "download" | "upload" | "youtube" | "playlist" | "chevron" | "zoomIn" | "zoomOut" | "rotate" | "print" | "pages" | "panelOpen" | "panelClose" | "minimize";

const libraryIconMap: Record<IconName, ClusterIconName> = {
  folder: "folder",
  file: "file",
  text: "text",
  image: "image",
  video: "video",
  audio: "audio",
  pdf: "pdf",
  archive: "archive",
  model: "model",
  link: "link",
  note: "note",
  code: "code",
  game: "game",
  star: "star",
  palette: "palette",
  search: "search",
  grid: "grid",
  list: "list",
  close: "close",
  play: "play",
  pause: "pause",
  volume: "volume",
  mute: "mute",
  fullscreen: "fullscreen",
  reset: "reset",
  previous: "previous",
  next: "next",
  rewind: "rewind",
  forward: "forward",
  speed: "speed",
  keyboard: "keyboard",
  download: "download",
  upload: "upload",
  youtube: "video",
  playlist: "playlist",
  chevron: "chevron-right",
  zoomIn: "zoom-in",
  zoomOut: "zoom-out",
  rotate: "rotate",
  print: "print",
  pages: "pages",
  panelOpen: "panel-open",
  panelClose: "panel-close",
  minimize: "minimize",
};

export function LibraryIcon({ name, size = 20, className = "", style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <ClusterIcon name={libraryIconMap[name]} className={className} style={style} width={size} height={size} />;
}

/** A shared icon-library id ("icon:set:name", "glyph:…", "brand:…") rather than a classic name. */
export function isLibraryIconId(value?: string | null): value is string {
  return Boolean(value && value.includes(":"));
}

/** Any icon id or classic name at a fixed pixel size, tinted with currentColor. */
export function LibraryGlyph({ icon, fallback = "folder", size = 20, label = "" }: { icon?: string | null; fallback?: IconName; size?: number; label?: string }) {
  if (isLibraryIconId(icon)) return <span className="lib-glyph" style={{ width: size, height: size }}><ResourceIdentityMark iconId={icon} label={label} /></span>;
  const name = (icon && icon in libraryIconMap ? icon : fallback) as IconName;
  return <LibraryIcon name={name} size={size} />;
}

/** The icon for a Library item: folders honor their chosen icon. */
export function LibraryItemGlyph({ item, size = 20 }: { item: LibraryItem; size?: number }) {
  return item.type === "folder" ? <LibraryGlyph icon={item.folderIcon} size={size} label={item.title} /> : <LibraryIcon name={itemIconName(item)} size={size} />;
}

export function folderIconName(item: Pick<LibraryItem, "folderIcon">): IconName {
  const candidate = item.folderIcon as IconName | null | undefined;
  return candidate && ["folder", "game", "image", "video", "model", "code", "note", "archive", "star", "palette"].includes(candidate) ? candidate : "folder";
}

export function itemIconName(item: LibraryItem): IconName {
  if (item.type === "folder") return folderIconName(item);
  if (item.type === "youtube-video") return "youtube";
  if (item.type === "youtube-playlist") return "playlist";
  if (item.mimeGroup === "image") return "image";
  if (item.mimeGroup === "video") return "video";
  if (item.mimeGroup === "audio") return "audio";
  if (item.mimeGroup === "pdf") return "pdf";
  if (item.mimeGroup === "archive") return "archive";
  if (item.mimeGroup === "office" || item.mimeGroup === "ebook") return "text";
  if (item.mimeGroup === "text") return item.extension && ["js", "jsx", "ts", "tsx", "css", "html", "json", "xml", "yaml", "yml", "toml", "sql", "py", "cpp", "c", "cs", "java", "rs", "go", "sh"].includes(item.extension) ? "code" : "text";
  if (item.mimeGroup === "model") return "model";
  if (item.type === "reference" || item.type === "link") return "link";
  if (item.type === "note" || item.type === "spec" || item.type === "decision") return "note";
  return "file";
}
