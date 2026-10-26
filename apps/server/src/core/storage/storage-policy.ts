import type { StoragePlacementInput, StorageTier } from "./storage-types.js";

export function chooseStorageTier(input: StoragePlacementInput): StorageTier {
  if (input.purpose === "external") return "external";
  if (input.purpose === "upload") return "temporary";
  if (input.regenerable || input.purpose === "preview" || input.purpose === "derivative") return "cache";
  if (input.archived || input.purpose === "backup") return "archive";
  if (input.activeProject && (input.purpose === "source" || input.purpose === "proxy")) return "hot";
  return "standard";
}
