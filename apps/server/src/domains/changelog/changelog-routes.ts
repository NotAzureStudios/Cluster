/** What's new: Cluster's published releases, read from GitHub and cached,
 *  so release notes stay current without being written into the app. */
const RELEASES_URL = "https://api.github.com/repos/NotAzureStudios/Cluster/releases?per_page=60";
const CACHE_MS = 30 * 60_000;

type Release = { version: string; title: string; publishedOn: string; sourceUrl: string; changes: string[] };

function changesFrom(body: string) {
  const lines = String(body || "").split(/\r?\n/);
  const start = lines.findIndex((line) => /^\*\*changes\*\*/i.test(line.trim()) || /^#+\s*changes/i.test(line.trim()));
  const bullets: string[] = [];
  for (const line of lines.slice(start >= 0 ? start + 1 : 0)) {
    const trimmed = line.trim();
    if (/^[-*]\s+/.test(trimmed)) bullets.push(trimmed.replace(/^[-*]\s+/, "").replace(/\*\*/g, ""));
    else if (bullets.length && (/^\*\*/.test(trimmed) || /^#/.test(trimmed))) break;
  }
  return bullets.slice(0, 40);
}

export function registerChangelogRoutes(deps: { app: any; getCurrentUser: (request: any) => Promise<any>; fetchWithTimeout: (url: string, init?: RequestInit, timeoutMs?: number, policy?: Record<string, unknown>) => Promise<Response> }) {
  const { app, getCurrentUser, fetchWithTimeout } = deps;
  let cache: { at: number; releases: Release[] } | null = null;

  app.get("/api/changelog", async (request: any, reply: any) => {
    if (!(await getCurrentUser(request))) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Sign in first." });
    reply.header("Cache-Control", "private, max-age=300");
    if (cache && Date.now() - cache.at < CACHE_MS) return { ok: true, releases: cache.releases, checkedAt: new Date(cache.at).toISOString() };
    try {
      const response = await fetchWithTimeout(RELEASES_URL, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Cluster" } }, 10_000, { purpose: "Cluster release notes", requireHttps: true });
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
      const rows = await response.json() as any[];
      const releases = (Array.isArray(rows) ? rows : [])
        .filter((row) => !row.draft && !row.prerelease && /^v\d/.test(String(row.tag_name || "")))
        .map((row): Release => {
          const changes = changesFrom(row.body);
          const version = String(row.tag_name);
          return { version, title: changes[0] || String(row.name || version).replace(/\s*\|.*$/, ""), publishedOn: String(row.published_at || row.created_at || "").slice(0, 10), sourceUrl: String(row.html_url || ""), changes };
        });
      cache = { at: Date.now(), releases };
      return { ok: true, releases, checkedAt: new Date().toISOString() };
    } catch (error) {
      if (cache) return { ok: true, releases: cache.releases, checkedAt: new Date(cache.at).toISOString(), stale: true };
      return reply.code(502).send({ ok: false, error: error instanceof Error ? error.message : "Release notes are unavailable." });
    }
  });
}
