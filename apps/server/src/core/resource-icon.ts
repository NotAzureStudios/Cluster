// Built-in marks, plus any Tabler icon or Simple Icons brand logo
// ("icon:<set>:<name>", rendered by the client from its bundled library).
export const BUILT_IN_RESOURCE_ICONS = [
  "glyph:project", "glyph:game", "glyph:code", "glyph:video", "glyph:image", "glyph:model",
  "glyph:folder", "glyph:library", "glyph:work", "glyph:calendar", "glyph:packet", "glyph:grid",
  "glyph:check", "glyph:users", "brand:as-git", "brand:discord", "brand:steam", "brand:epic",
  "brand:unreal", "brand:blender", "brand:curseforge", "brand:minecraft",
] as const;
const LIBRARY_ICON = /^icon:(?:tabler|simple-icons):[a-z0-9-]{1,80}$/;

export function isResourceIconId(value: unknown): value is string {
  return typeof value === "string" && ((BUILT_IN_RESOURCE_ICONS as readonly string[]).includes(value) || LIBRARY_ICON.test(value));
}
