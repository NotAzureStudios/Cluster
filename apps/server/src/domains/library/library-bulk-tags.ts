/** One canonical tag mutation for Library bulk edit. Preserves unrelated tags. */
export function applyLibraryBulkTagChange(current: readonly string[], tag: string, action: "tag" | "untag"): string[] {
  const normalized = tag.trim();
  if (!normalized || normalized.length > 80) throw new Error("A valid tag of up to 80 characters is required.");
  const previous = [...new Set(current.map((item) => String(item).trim()).filter(Boolean))];
  return action === "tag" ? [...new Set([...previous, normalized])] : previous.filter((item) => item !== normalized);
}
