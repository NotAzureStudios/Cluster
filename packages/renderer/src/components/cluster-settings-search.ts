/** Searchable, registered settings locations. All targets are authored locally, not server-supplied selectors. */
export type ClusterSettingsSearchEntry<Id extends string> = {
  id: string;
  section: Id;
  label: string;
  description?: string;
  keywords?: string;
  targetId?: string;
};

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

/** Match all query terms and prioritize exact/leading labels ahead of help metadata. */
export function findClusterSettings<Id extends string>(
  entries: readonly ClusterSettingsSearchEntry<Id>[],
  query: string,
  limit = 8,
): ClusterSettingsSearchEntry<Id>[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return [];
  const ranked: Array<{ entry: ClusterSettingsSearchEntry<Id>; score: number; originalIndex: number }> = [];
  for (const [originalIndex, entry] of entries.entries()) {
    const title = normalize(entry.label);
    const section = normalize(String(entry.section));
    const description = normalize(entry.description || "");
    const keywords = normalize(entry.keywords || "");
    const combined = title + " " + section + " " + description + " " + keywords;
    if (!terms.every((term) => combined.includes(term))) continue;
    const score = terms.reduce((sum, term) =>
      sum + (title === term ? 90 : title.startsWith(term) ? 50 : title.includes(term) ? 25 : section.includes(term) ? 13 : keywords.includes(term) ? 9 : 3), 0);
    ranked.push({ entry, score, originalIndex });
  }
  return ranked.sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex).slice(0, Math.max(0, Math.min(limit, 50))).map((item) => item.entry);
}
