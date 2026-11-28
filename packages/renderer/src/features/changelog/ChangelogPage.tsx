import "./changelog.css";
import { useEffect, useState } from "react";
import { APP_VERSION_LABEL } from "../../core/version";
import { queryApi } from "../../core/api";

type Release = { version: string; title: string; publishedOn: string; sourceUrl: string; changes: string[] };

/** Release notes come from Cluster's GitHub releases, read by the server. */
export default function ChangelogPage() {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    queryApi<{ releases: Release[] }>("/api/changelog", { staleMs: 5 * 60_000, maxAgeMs: 30 * 60_000, tags: ["changelog"] })
      .then((result) => setReleases(result.releases))
      .catch((reason) => { setReleases([]); setError(reason instanceof Error ? reason.message : "Release notes are unavailable."); });
  }, []);
  return <section className="panel cluster-release-history-v11" aria-labelledby="cluster-release-history-title">
    <header className="cluster-release-history-head-v11">
      <div>
        <h1 id="cluster-release-history-title">What's new</h1>
      </div>
      <span className="cluster-release-current-v11" title="Installed version">{APP_VERSION_LABEL}</span>
    </header>
    {releases === null ? <p className="muted">Loading…</p> : releases.length ? <ol className="cluster-release-history-list-v11">
      {releases.map((release, index) => <li key={release.version}>
        <details className="cluster-release-history-entry-v11" open={index === 0}>
          <summary>
            <span className="cluster-release-history-version-v11">{release.version}</span>
            <span className="cluster-release-history-title-v11">{release.title}</span>
            <time dateTime={release.publishedOn}>{release.publishedOn}</time>
            <span className="cluster-release-history-chevron-v11" aria-hidden="true">⌄</span>
          </summary>
          <div className="cluster-release-history-body-v11">
            {release.changes.length ? <ul>{release.changes.map((change) => <li key={change}>{change}</li>)}</ul> : null}
            <a href={release.sourceUrl} target="_blank" rel="noopener noreferrer">Full release notes</a>
          </div>
        </details>
      </li>)}
    </ol> : <p className="muted">{error || "No releases yet."} <a href="https://github.com/NotAzureStudios/Cluster/releases" target="_blank" rel="noopener noreferrer">Releases on GitHub</a></p>}
  </section>;
}
