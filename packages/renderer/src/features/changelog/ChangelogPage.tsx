import "./changelog.css";
import { APP_VERSION_LABEL } from "../../core/version";
import { CLUSTER_CHANGELOG } from "./data/cluster-changelog";

/** Release history is publication history, not the pre-1.0 development log. */
export default function ChangelogPage() {
  return <section className="panel cluster-release-history-v11" aria-labelledby="cluster-release-history-title">
    <header className="cluster-release-history-head-v11">
      <div>
        <span className="eyebrow">Releases</span>
        <h1 id="cluster-release-history-title">What's changed</h1>
        <p>Published Cluster releases, starting with 1.0. Development builds and internal milestones are not included.</p>
      </div>
      <span className="cluster-release-current-v11">Installed {APP_VERSION_LABEL}</span>
    </header>
    {CLUSTER_CHANGELOG.length ? <ol className="cluster-release-history-list-v11">
      {CLUSTER_CHANGELOG.map((release, index) => <li key={release.version}>
        <details className="cluster-release-history-entry-v11" open={index === 0}>
          <summary>
            <span className="cluster-release-history-marker-v11" aria-hidden="true" />
            <span className="cluster-release-history-version-v11">{release.version}</span>
            <span className="cluster-release-history-title-v11">{release.title}</span>
            <time dateTime={release.publishedOn}>{release.publishedOn}</time>
            <span className="cluster-release-history-chevron-v11" aria-hidden="true">⌄</span>
          </summary>
          <div className="cluster-release-history-body-v11">
            <ul>{release.changes.map((change) => <li key={change}>{change}</li>)}</ul>
            <a href={release.sourceUrl} target="_blank" rel="noopener noreferrer">Full release notes</a>
          </div>
        </details>
      </li>)}
    </ol> : <p className="muted">No published releases are recorded.</p>}
  </section>;
}
