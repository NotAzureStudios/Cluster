import "./changelog.css";
import { APP_VERSION_LABEL } from "../../core/version";
import { CLUSTER_CHANGELOG } from "./data/cluster-changelog";

export default function ChangelogPage() {
  return (
    <section className="panel changelog-panel-v124">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Changelog</p>
          <h2>Cluster release history</h2>
          <p className="muted tight">
            Recent changes inside the app, without making people excavate
            repository notes.
          </p>
        </div>
        <span className="soft-pill">Current {APP_VERSION_LABEL}</span>
      </div>
      <div className="changelog-list-v124">
        {CLUSTER_CHANGELOG.map((release) => (
          <article key={`${release.version}-${release.title}`}>
            <div>
              <strong>{release.version}</strong>
              <span>{release.title}</span>
            </div>
            <ul>
              {release.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
