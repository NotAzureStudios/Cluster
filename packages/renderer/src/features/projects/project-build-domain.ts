import type { BuildArtifactRecord, BuildPlatformLane, BuildPlatformProfile, Project, TimelineEntry } from "../application/application-models";

export function projectBuildLaneFromText(text: string) {
  const clean = text.toLowerCase();
  if (/launch|publish|ship|release\s+day|go live|gold/.test(clean)) return "launch";
  if (/release candidate|\brc\b|candidate|cert/.test(clean)) return "rc";
  if (/qa|handoff|regression|verification|test pass/.test(clean)) return "qa";
  if (/playtest|play test|beta|alpha|feedback/.test(clean)) return "playtest";
  return "internal";
}

export function projectBuildLaneLabel(lane: string) {
  return lane === "launch" ? "Launch" : lane === "rc" ? "RC" : lane === "qa" ? "QA" : lane === "playtest" ? "Playtest" : "Internal";
}

export function isProjectBuildEntry(entry: TimelineEntry) {
  const text = `${entry.type} ${entry.title} ${entry.description || ""}`.toLowerCase();
  return entry.source !== "time" && /build|release|publish|ship|launch|qa|handoff|playtest|candidate|rc|artifact|version|cert/.test(text);
}

export function projectHasBuildSignals(project: Project, artifacts: BuildArtifactRecord[] = []) {
  const projectArtifacts = artifacts.filter((artifact) => artifact.projectId === project.id);
  const text = `${project.description || ""} ${(project.libraryItems || []).map((item) => item.title).join(" ")}`.toLowerCase();
  return projectArtifacts.length > 0 || /build|release|qa|playtest|launch|artifact|version/.test(text);
}

export { BUILD_PLATFORM_PROFILES, CURSEFORGE_FIELDS, GENERIC_BUILD_LANES } from "./project-build-profiles";

export function buildPlatformLaneLabel(lanes: BuildPlatformLane[], lane: string) {
  return lanes.find((item) => item.id === lane)?.label || projectBuildLaneLabel(lane);
}

export function defaultPlatformMeta(profile: BuildPlatformProfile) {
  return Object.fromEntries(profile.fields.map((field) => [field.id, ""])) as Record<string, string>;
}

export function platformMetaSummary(profile: BuildPlatformProfile, meta?: Record<string, string>) {
  const clean = profile.fields.map((field) => meta?.[field.id]).filter(Boolean) as string[];
  return clean.slice(0, 3).join(" · ");
}

