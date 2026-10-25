import type { ReactNode } from "react";
import { runtimeStyle } from "../core/runtime-style";
import { ClusterButton } from "./ClusterButton";
import {
  clampVisualValue,
  visualDelta,
  visualStateLabel,
  type VisualDataState,
  type VisualDatum,
  type VisualDensity,
  type VisualSelection,
  type VisualTone,
} from "./visual-intelligence";
import "./cluster-visual-intelligence.css";

const toneClass = (tone: VisualTone = "neutral") => `cluster-visual-tone-${tone}`;
const densityClass = (density: VisualDensity = "comfortable") => `cluster-visual-density-${density}`;
const datumValue = (item: VisualDatum) => item.value === undefined ? "" : String(item.value);

function visualTitle(item: VisualDatum) {
  return `${item.label}${item.value !== undefined ? `: ${datumValue(item)}` : ""}${item.detail ? `. ${item.detail}` : ""}`;
}

function visualMetric(item: VisualDatum) {
  const detail = item.detail?.trim();
  if (detail) return detail;
  return item.value === undefined ? "—" : String(item.value);
}

export function VisualState({
  state = "ready",
  label,
  children,
}: {
  state?: VisualDataState;
  label?: string;
  children?: ReactNode;
}) {
  if (state === "ready" || state === "partial" || state === "stale") {
    return <>{children}{state !== "ready" ? <span className="cluster-visual-state-note" role="status">{label || visualStateLabel(state)}</span> : null}</>;
  }
  return <div className="cluster-visual-state" role="status" aria-live="polite">{label || visualStateLabel(state)}</div>;
}

export function TrendIndicator({
  current,
  previous,
  label = "Trend",
}: {
  current: number;
  previous: number;
  label?: string;
}) {
  const delta = visualDelta(current, previous);
  return (
    <span className={`cluster-trend cluster-trend-${delta.direction}`} aria-label={`${label}: ${delta.label}`}>
      <span aria-hidden="true">{delta.direction === "up" ? "↑" : delta.direction === "down" ? "↓" : "→"}</span> {delta.label}
    </span>
  );
}

export function Sparkline({
  values,
  label = "Trend",
  state = "ready",
}: {
  values: number[];
  label?: string;
  state?: VisualDataState;
}) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return <VisualState state="empty" label={`${label}: no data`} />;
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  const range = max - min || 1;
  const points = finiteValues
    .map((value, index) => `${(index / Math.max(1, finiteValues.length - 1)) * 100},${28 - ((value - min) / range) * 24}`)
    .join(" ");
  return (
    <VisualState state={state}>
      <svg
        className="cluster-sparkline"
        viewBox="0 0 100 32"
        role="img"
        aria-label={`${label}: ${finiteValues.join(", ")}`}
        preserveAspectRatio="none"
      >
        <polyline points={points} />
      </svg>
    </VisualState>
  );
}

export function StatusStrip({
  items,
  label = "Status summary",
  density = "comfortable",
}: {
  items: VisualDatum[];
  label?: string;
  density?: VisualDensity;
}) {
  return (
    <div className={`cluster-status-strip ${densityClass(density)}`} role="list" aria-label={label}>
      {items.map((item) => (
        <div role="listitem" className={`cluster-status-strip-item ${toneClass(item.tone)}`} key={item.id}>
          <span className="cluster-visual-marker" aria-hidden="true" />
          <span><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</span>
          {item.value !== undefined ? <b>{item.value}</b> : null}
        </div>
      ))}
    </div>
  );
}

export const HealthStrip = StatusStrip;

export function ActivityHeatmap({
  items,
  label = "Activity",
  onSelect,
  density = "comfortable",
}: {
  items: VisualDatum[];
  label?: string;
  onSelect?: (selection: VisualSelection) => void;
  density?: VisualDensity;
}) {
  return (
    <div className={`cluster-heatmap ${densityClass(density)}`} role="grid" aria-label={label}>
      {items.map((item) => {
        const title = visualTitle(item);
        const style = runtimeStyle({
          "--cluster-visual-intensity": String(clampVisualValue(typeof item.value === "number" ? item.value : 0) / 100),
        });
        return onSelect ? (
          <ClusterButton
            unstyled
            type="button"
            role="gridcell"
            key={item.id}
            className={`cluster-heat-cell ${toneClass(item.tone)}`}
            style={style}
            aria-label={title}
            title={title}
            onClick={() => onSelect({ visualId: label, datumId: item.id, label: item.label })}
          />
        ) : (
          <span
            role="gridcell"
            key={item.id}
            className={`cluster-heat-cell ${toneClass(item.tone)}`}
            style={style}
            aria-label={title}
            title={title}
          />
        );
      })}
    </div>
  );
}

export function CoverageMatrix({
  rows,
  columns,
  values,
  label = "Coverage matrix",
  onSelect,
  density = "comfortable",
}: {
  rows: { id: string; label: string }[];
  columns: { id: string; label: string }[];
  values: Record<string, VisualDatum>;
  label?: string;
  onSelect?: (selection: VisualSelection) => void;
  density?: VisualDensity;
}) {
  return (
    <div className={`cluster-coverage-wrap ${densityClass(density)}`}>
      <div
        className="cluster-coverage-matrix"
        role="grid"
        aria-label={label}
        style={runtimeStyle({ gridTemplateColumns: `minmax(8rem, 1.4fr) repeat(${columns.length}, minmax(5rem, 1fr))` })}
      >
        <div className="cluster-coverage-head" role="row">
          <span role="columnheader" aria-label="Metric" />
          {columns.map((column) => <strong role="columnheader" key={column.id}>{column.label}</strong>)}
        </div>
        {rows.map((row) => (
          <div className="cluster-coverage-row" role="row" key={row.id}>
            <strong role="rowheader">{row.label}</strong>
            {columns.map((column) => {
              const datum = values[`${row.id}:${column.id}`] || {
                id: `${row.id}:${column.id}`,
                label: `${row.label}, ${column.label}`,
                value: 0,
                tone: "neutral" as const,
              };
              const metric = visualMetric(datum);
              return onSelect ? (
                <ClusterButton
                  unstyled
                  type="button"
                  role="gridcell"
                  key={column.id}
                  className={`cluster-coverage-cell ${toneClass(datum.tone)}`}
                  aria-label={`${datum.label}: ${metric}`}
                  onClick={() => onSelect({ visualId: label, datumId: datum.id, label: datum.label })}
                >
                  <span className="cluster-visual-marker" aria-hidden="true" />{metric}
                </ClusterButton>
              ) : (
                <div
                  role="gridcell"
                  key={column.id}
                  className={`cluster-coverage-cell ${toneClass(datum.tone)}`}
                  aria-label={`${datum.label}: ${metric}`}
                >
                  <span className="cluster-visual-marker" aria-hidden="true" />{metric}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PipelineRail({
  items,
  label = "Pipeline",
  onSelect,
  density = "comfortable",
}: {
  items: VisualDatum[];
  label?: string;
  onSelect?: (selection: VisualSelection) => void;
  density?: VisualDensity;
}) {
  return (
    <ol className={`cluster-pipeline ${densityClass(density)}`} aria-label={label}>
      {items.map((item, index) => {
        const content = <><span className="cluster-pipeline-node" aria-hidden="true">{index + 1}</span><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</>;
        return (
          <li key={item.id} className={toneClass(item.tone)}>
            {onSelect ? (
              <ClusterButton unstyled type="button" className="cluster-visual-interactive" onClick={() => onSelect({ visualId: label, datumId: item.id, label: item.label })} aria-label={visualTitle(item)}>{content}</ClusterButton>
            ) : (
              <div className="cluster-visual-static" aria-label={visualTitle(item)}>{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function VisualTimeline({
  items,
  label = "Timeline",
  onSelect,
  density = "comfortable",
}: {
  items: VisualDatum[];
  label?: string;
  onSelect?: (selection: VisualSelection) => void;
  density?: VisualDensity;
}) {
  return (
    <ol className={`cluster-visual-timeline ${densityClass(density)}`} aria-label={label}>
      {items.map((item) => {
        const content = <><span className="cluster-visual-marker" aria-hidden="true" /><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</>;
        return (
          <li key={item.id} className={toneClass(item.tone)}>
            {onSelect ? (
              <ClusterButton unstyled type="button" className="cluster-visual-interactive" onClick={() => onSelect({ visualId: label, datumId: item.id, label: item.label })} aria-label={visualTitle(item)}>{content}</ClusterButton>
            ) : (
              <div className="cluster-visual-static" aria-label={visualTitle(item)}>{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function DependencyGraph({
  nodes,
  edges,
  label = "Dependencies",
  onSelect,
  density = "comfortable",
}: {
  nodes: VisualDatum[];
  edges: { from: string; to: string; label?: string }[];
  label?: string;
  onSelect?: (selection: VisualSelection) => void;
  density?: VisualDensity;
}) {
  const nodeLabels = new Map(nodes.map((node) => [node.id, node.label]));
  return (
    <div className={`cluster-dependency-graph ${densityClass(density)}`} role="group" aria-label={label}>
      <div className="cluster-dependency-nodes">
        {nodes.map((node) => {
          const content = <><span className="cluster-visual-marker" aria-hidden="true" /><strong>{node.label}</strong>{node.detail ? <small>{node.detail}</small> : null}</>;
          return onSelect ? (
            <ClusterButton
              unstyled
              type="button"
              key={node.id}
              className={`${toneClass(node.tone)} cluster-visual-interactive`}
              onClick={() => onSelect({ visualId: label, datumId: node.id, label: node.label })}
              aria-label={visualTitle(node)}
            >
              {content}
            </ClusterButton>
          ) : (
            <div key={node.id} className={`${toneClass(node.tone)} cluster-visual-static`} aria-label={visualTitle(node)}>{content}</div>
          );
        })}
      </div>
      <ul className="cluster-dependency-edges" aria-label="Relationships">
        {edges.map((edge, index) => (
          <li key={`${edge.from}-${edge.to}-${index}`}>{nodeLabels.get(edge.from) || edge.from} → {nodeLabels.get(edge.to) || edge.to}{edge.label ? ` · ${edge.label}` : ""}</li>
        ))}
      </ul>
    </div>
  );
}
