import type { CSSProperties } from "react";
import { ClusterIcon, type ClusterIconName } from "./ClusterIcon";
import "./resource-identity.css";

export const PROJECT_ICON_OPTIONS = [
  { id: "glyph:project", label: "Project", glyph: "project" },
  { id: "glyph:game", label: "Game", glyph: "game" },
  { id: "glyph:code", label: "Code", glyph: "code" },
  { id: "glyph:video", label: "Video", glyph: "video" },
  { id: "glyph:image", label: "Image", glyph: "image" },
  { id: "glyph:model", label: "3D", glyph: "model" },
  { id: "glyph:folder", label: "Folder", glyph: "folder" },
  { id: "glyph:library", label: "Library", glyph: "library" },
  { id: "glyph:work", label: "Work", glyph: "work" },
  { id: "glyph:calendar", label: "Calendar", glyph: "calendar" },
  { id: "glyph:packet", label: "Packet", glyph: "packet" },
  { id: "glyph:grid", label: "Grid", glyph: "grid" },
  { id: "glyph:check", label: "Quality / Done", glyph: "check" },
  { id: "glyph:users", label: "People", glyph: "users" },
  { id: "brand:as-git", label: "Azure Studios Git", monogram: "Git", image: "/brand/as-git.webp" },
  { id: "brand:discord", label: "Discord", monogram: "D" },
  { id: "brand:steam", label: "Steam", monogram: "S" },
  { id: "brand:epic", label: "Epic Games", monogram: "E" },
  { id: "brand:unreal", label: "Unreal Engine", monogram: "UE" },
  { id: "brand:blender", label: "Blender", monogram: "B" },
  { id: "brand:curseforge", label: "CurseForge", monogram: "CF" },
  { id: "brand:minecraft", label: "Minecraft", monogram: "MC" },
] as const;

export function resourceIconDefault(projectType?: string | null): string {
  const type = String(projectType || "").toLowerCase();
  if (/game|unreal|fortnite|ark|minecraft/.test(type)) return "glyph:game";
  if (/video|film|media/.test(type)) return "glyph:video";
  if (/blender|3d|model/.test(type)) return "glyph:model";
  if (/code|software|git/.test(type)) return "glyph:code";
  return "glyph:project";
}

export function ResourceIdentityMark({ iconId, projectId, projectType, label, className = "", accentColor }: {
  iconId?: string | null;
  projectId?: string;
  projectType?: string | null;
  label: string;
  className?: string;
  accentColor?: string | null;
}) {
  const choice = iconId || resourceIconDefault(projectType);
  const option = PROJECT_ICON_OPTIONS.find(item => item.id === choice);
  const glyph = option && "glyph" in option ? option.glyph : "project";
  const assetName = /^asset:([a-f0-9]{24}-[a-zA-Z0-9._-]{1,100}\.(?:png|jpg|webp))$/.exec(choice)?.[1];
  const image = assetName && projectId ? `/api/projects/${encodeURIComponent(projectId)}/icon/${encodeURIComponent(assetName)}` : option && "image" in option ? option.image : undefined;
  return <span className={`resource-identity-mark ${className}`} style={{ "--resource-icon-accent": accentColor || "#57c1ff" } as CSSProperties} title={option?.label || label} role="img" aria-label={`${label} icon`}>
    {image ? <img src={image} alt="" loading="lazy" decoding="async" /> : option && "monogram" in option ? <strong aria-hidden="true">{option.monogram}</strong> : <ClusterIcon name={glyph as ClusterIconName} />}
  </span>;
}
