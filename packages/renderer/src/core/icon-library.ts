// Tabler icons and Simple Icons brand logos, fetched on demand from the
// chunks tools/scripts/generate-icon-library.mjs writes into the web build.
// Stored resource icons use "icon:<set>:<name>".
export const ICON_LIBRARY_SETS = { tabler: "Icons", "simple-icons": "Brands" } as const;
export type IconLibrarySet = keyof typeof ICON_LIBRARY_SETS;
export type LibraryGlyph = { body: string; width: number; height: number };
type SetIndex = { prefix: string; width: number; height: number; chunk: number; names: string[]; positions: Map<string, number> };

const ICON_ID = /^icon:(tabler|simple-icons):([a-z0-9-]{1,80})$/;
const indexes = new Map<string, Promise<SetIndex>>();
const chunks = new Map<string, Promise<Record<string, string | { body: string; width?: number; height?: number }>>>();

export function parseLibraryIconId(id?: string | null): { set: IconLibrarySet; name: string } | null {
  const match = ICON_ID.exec(String(id || ""));
  return match ? { set: match[1] as IconLibrarySet, name: match[2] } : null;
}

export function libraryIconId(set: IconLibrarySet, name: string) { return `icon:${set}:${name}`; }

export function loadIconIndex(set: IconLibrarySet) {
  let pending = indexes.get(set);
  if (!pending) {
    pending = fetch(`/icon-library/${set}/index.json`).then((response) => {
      if (!response.ok) throw new Error("Icon library unavailable");
      return response.json();
    }).then((index) => ({ ...index, positions: new Map(index.names.map((name: string, position: number) => [name, position])) }));
    pending.catch(() => indexes.delete(set));
    indexes.set(set, pending);
  }
  return pending;
}

export async function loadLibraryGlyph(set: IconLibrarySet, name: string): Promise<LibraryGlyph | null> {
  const index = await loadIconIndex(set);
  const position = index.positions.get(name);
  if (position == null) return null;
  const key = `${set}/${Math.floor(position / index.chunk)}`;
  let pending = chunks.get(key);
  if (!pending) {
    pending = fetch(`/icon-library/${key}.json`).then((response) => { if (!response.ok) throw new Error("Icon chunk unavailable"); return response.json(); });
    pending.catch(() => chunks.delete(key));
    chunks.set(key, pending);
  }
  const entry = (await pending)[name];
  if (!entry) return null;
  return typeof entry === "string" ? { body: entry, width: index.width, height: index.height } : { body: entry.body, width: entry.width || index.width, height: entry.height || index.height };
}
