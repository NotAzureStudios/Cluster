import type { BoardLabelDefinition } from "../application/application-models";

export const BOARD_APPEARANCE_PRESETS = [
  { id: "ocean", label: "Ocean", color: "#2563eb", style: "gradient" as const },
  { id: "slate", label: "Slate", color: "#475569", style: "soft" as const },
  { id: "forest", label: "Forest", color: "#15803d", style: "gradient" as const },
  { id: "sunset", label: "Sunset", color: "#ea580c", style: "gradient" as const },
  { id: "violet", label: "Violet", color: "#7c3aed", style: "gradient" as const },
  { id: "rose", label: "Rose", color: "#be123c", style: "soft" as const },
] as const;

export const DEFAULT_BOARD_LABELS: BoardLabelDefinition[] = [
  { id: "design", name: "Design", color: "#8b5cf6" },
  { id: "engineering", name: "Engineering", color: "#2563eb" },
  { id: "art", name: "Art", color: "#db2777" },
  { id: "qa", name: "QA", color: "#f97316" },
  { id: "blocked", name: "Blocked", color: "#dc2626" },
  { id: "ready", name: "Ready", color: "#16a34a" },
];

const FALLBACK_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#475569"];

export function boardLabelColor(name: string, definitions: BoardLabelDefinition[] = []) {
  const found = definitions.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (found) return found.color;
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

export function boardThemeBackground(color = "#2563eb", style: "soft" | "solid" | "gradient" = "soft") {
  if (style === "solid") return color;
  if (style === "gradient") return `linear-gradient(135deg, color-mix(in srgb, ${color} 88%, #020617), color-mix(in srgb, ${color} 58%, #0f172a))`;
  return `linear-gradient(180deg, color-mix(in srgb, ${color} 15%, transparent), transparent 34%)`;
}
