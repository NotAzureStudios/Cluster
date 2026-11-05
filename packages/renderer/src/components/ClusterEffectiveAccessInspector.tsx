import { useState } from "react";
import "./cluster-effective-access-inspector.css";

/** The server owns resolution and provenance. This component only presents the
 * read-only role-policy dry run returned by /api/access/permission-preview. */
export type ClusterEffectiveAccessLevel = {
  level?: string;
  provenance?: { effective?: { label?: string; sourceId?: string } | null } | null;
};

export type ClusterEffectiveAccessChange = {
  tool: string;
  current: ClusterEffectiveAccessLevel;
  proposed: ClusterEffectiveAccessLevel;
};

export type ClusterEffectiveAccessPreview = {
  ok: boolean;
  roleId: string;
  departmentId: string | null;
  matrix: Record<string, ClusterEffectiveAccessLevel>;
  changes: ClusterEffectiveAccessChange[];
};

type AccessTool = { key: string; label: string };
type AccessRow = {
  key: string;
  label: string;
  current: string;
  proposed: string;
  source: string;
  changed: boolean;
};

/** No local permission calculation, unknown input never becomes a default grant. */
export function projectEffectiveAccessPreview(
  preview: ClusterEffectiveAccessPreview,
  tools: readonly AccessTool[],
): AccessRow[] {
  const changed = new Map(preview.changes.map((entry) => [entry.tool, entry]));
  return tools.map((tool) => {
    const delta = changed.get(tool.key);
    const matrix = preview.matrix[tool.key];
    const current = delta?.current?.level ?? (matrix ? matrix.level : undefined) ?? "Unknown";
    const proposed = delta?.proposed?.level ?? matrix?.level ?? "Unknown";
    const provenance = delta?.proposed?.provenance?.effective ?? matrix?.provenance?.effective;
    return {
      key: tool.key,
      label: tool.label,
      current,
      proposed,
      source: provenance?.label || "Source not reported",
      changed: Boolean(delta),
    };
  });
}

export function ClusterEffectiveAccessInspector({
  preview,
  tools,
}: {
  preview: ClusterEffectiveAccessPreview;
  tools: readonly AccessTool[];
}) {
  const [changedOnly, setChangedOnly] = useState(true);
  const rows = projectEffectiveAccessPreview(preview, tools);
  const visible = changedOnly ? rows.filter((row) => row.changed) : rows;
  const changedCount = rows.filter((row) => row.changed).length;
  return (
    <section className="cluster-effective-access-v11" aria-label="Effective role policy preview">
      <div className="cluster-effective-access-head-v11">
        <div>
          <strong>Server-evaluated role policy</strong>
          <span>{changedCount} change{changedCount === 1 ? "" : "s"} across {rows.length} tools</span>
        </div>
        <label>
          <input type="checkbox" checked={changedOnly} onChange={(event) => setChangedOnly(event.target.checked)} />
          Changed only
        </label>
      </div>
      <p className="cluster-effective-access-scope-v11">
        Comparing the saved Studio policy with the current unsaved draft. This is a read-only role preview,
        not an account-specific access decision. User overrides, account state, and resource restrictions
        may further reduce actual access.
      </p>
      {changedOnly && !changedCount && (
        <p className="cluster-effective-access-empty-v11" role="status">
          No effective level or source changes. Show all tools to inspect the complete proposed policy.
        </p>
      )}
      {visible.length > 0 && (
        <div className="cluster-effective-access-scroll-v11" role="region" tabIndex={0} aria-label="Effective access comparison table; scroll horizontally if needed">
          <table>
            <thead><tr><th scope="col">Tool</th><th scope="col">Current</th><th scope="col">Proposed</th><th scope="col">Effective source</th></tr></thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.key} data-changed={row.changed ? "true" : "false"}>
                  <th scope="row">{row.label}</th>
                  <td>{row.current}</td>
                  <td><strong>{row.proposed}</strong></td>
                  <td>{row.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
