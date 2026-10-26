export function parseMediaRate(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  const [left, right] = text.split("/").map(Number);
  const rate = right ? left / right : left;
  return Number.isFinite(rate) && rate > 0 ? Number(rate.toFixed(4)) : null;
}

export function safeMediaJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}
