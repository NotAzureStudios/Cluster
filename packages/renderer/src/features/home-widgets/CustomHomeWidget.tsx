import { useMemo, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { InlineLoadingState } from "../../components/LoadingState";
import { RequestStatusLine } from "../../components/RequestState";
import {
  validateCustomHomeWidgetManifest,
  type CustomHomeWidgetBlock,
  type CustomHomeWidgetManifest,
  type HomeWidgetConfig,
  type HomeWidgetListBinding,
  type HomeWidgetMetricBinding,
  type HomeWidgetRuntimeStatus,
  type HomeWidgetSize,
} from "./home-widget-model";
import { useVisibleTicker } from "../../core/visible-ticker";
import { useHomeScopedCounts } from "./home-scoped-aggregate";
import { filterHomeWidgetItems, homeWidgetConfiguredLimit, homeWidgetNeedsScopedAggregates, HOME_SCOPED_AGGREGATES_UNAVAILABLE, type HomeWidgetRuntimeContext } from "./home-widget-runtime-policy";

export type CustomHomeWidgetListItem = {
  id: string;
  title: string;
  detail?: string;
  value?: string | number;
  tone?: "good" | "warning" | "danger" | "accent" | "neutral";
  projectId?: string | null;
  userId?: string | null;
  roleId?: string | null;
  at?: string | null;
  savedViewId?: string | null;
  workTarget?: { projectId?: string | null; inspectScope?: string | null; inspectId?: string | null } | null;
};
export type CustomHomeWidgetRuntimeData = {
  metrics: Record<HomeWidgetMetricBinding, string | number>;
  lists: Record<HomeWidgetListBinding, CustomHomeWidgetListItem[]>;
};
export type CustomHomeWidgetActionTarget = Extract<CustomHomeWidgetBlock, { type: "action" }>["target"];
export type CustomHomeWidgetActions = Partial<Record<CustomHomeWidgetActionTarget, () => void>>;

function formatClock(format: "time" | "date" | "datetime" = "time", now: Date) {
  if (format === "date") return now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  if (format === "datetime") return `${now.toLocaleDateString([], { month: "short", day: "numeric" })} · ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function numberValue(value: string | number | undefined) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function blockLimit(size: HomeWidgetSize, blockLimitValue?: number, configLimit?: number) {
  const sizeLimit = size === "micro" ? 1 : size === "compact" ? 2 : size === "large" ? 6 : size === "feature" ? 8 : 4;
  return Math.max(1, Math.min(12, blockLimitValue ?? configLimit ?? sizeLimit));
}

function ListBlock({ label, items, emptyLabel = "No items" }: { label?: string; items: CustomHomeWidgetListItem[]; emptyLabel?: string }) {
  return <section className="home-widget-custom-list-v484">{label && <strong>{label}</strong>}{items.map((item) => <div key={item.id} data-tone={item.tone || "neutral"}><span>{item.title}</span>{item.detail && <em>{item.detail}</em>}{item.value !== undefined && <b>{item.value}</b>}</div>)}{!items.length && <ClusterEmptyState compact kind="empty" title={emptyLabel} description="This data source is currently clear." className="home-widget-empty-v485" />}</section>;
}

export function CustomHomeWidget({ manifest, size, data, status, config, runtimeContext, actions, primaryAction, onConfigure }: { manifest: CustomHomeWidgetManifest; size: HomeWidgetSize; data: CustomHomeWidgetRuntimeData; status?: HomeWidgetRuntimeStatus; config?: HomeWidgetConfig; runtimeContext?: HomeWidgetRuntimeContext; actions?: CustomHomeWidgetActions; primaryAction?: { label: string; onSelect: () => void }; onConfigure?: () => void }) {
  const validation = useMemo(() => validateCustomHomeWidgetManifest(manifest), [manifest]);
  const [now, setNow] = useState(() => new Date());
  const hasClock = validation.ok && Boolean(validation.manifest.content?.blocks.some((block) => block.type === "clock"));
  useVisibleTicker(() => setNow(new Date()), 30_000, hasClock);
  const scopedCounts = useHomeScopedCounts(validation.ok ? (validation.manifest.content?.blocks || []).flatMap((block) => block.type === "metric" || block.type === "status" || block.type === "trend" || block.type === "operation" ? [block.binding] : block.type === "progress" ? [block.value, block.total] : block.type === "matrix" ? block.bindings : []) : [], config, runtimeContext);

  if (!validation.ok) {
    return <article className="home-widget-card-v484 custom invalid" data-widget-size={size}><header><div><p className="eyebrow">Custom widget</p><h3>Invalid widget</h3></div></header><div className="home-widget-state-v485 error"><RequestStatusLine tone="danger" state="error">Manifest rejected: {validation.reason}</RequestStatusLine></div></article>;
  }
  if (status?.state === "loading") {
    return <article className="home-widget-card-v484 custom" data-widget-size={size} aria-busy="true"><InlineLoadingState label={`Loading ${validation.manifest.name}`} lines={3} className="home-widget-state-v485 loading" /></article>;
  }
  if (status?.state === "error") {
    return <article className="home-widget-card-v484 custom has-error" data-widget-size={size}><header><div><p className="eyebrow">Custom widget</p><h3>{validation.manifest.name}</h3></div></header><div className="home-widget-state-v485 error"><RequestStatusLine tone="danger" state="error">{status.error || "Cluster could not refresh the data this widget reads."}</RequestStatusLine>{status.onRetry && <ClusterButton variant="secondary" size="compact" onClick={status.onRetry}>Retry</ClusterButton>}</div></article>;
  }
  const safe = validation.manifest;
  const blocks = safe.content?.blocks || [];
  const scopedAggregatesUnavailable = homeWidgetNeedsScopedAggregates(config);
  const scopedMetricValue = (binding: HomeWidgetMetricBinding) => scopedAggregatesUnavailable ? (binding === "projects.total" || binding === "people.total" ? scopedCounts.values[binding]?.value : undefined) : data.metrics[binding];
  const metricLabel = (binding: HomeWidgetMetricBinding) => String(scopedMetricValue(binding) ?? "Not available");
  const renderList = (binding: HomeWidgetListBinding, limit?: number) => {
    const base = data.lists[binding] || [];
    const filtered = runtimeContext ? filterHomeWidgetItems(base, config, runtimeContext) : scopedAggregatesUnavailable ? [] : base;
    return filtered.slice(0, homeWidgetConfiguredLimit(config, blockLimit(size, limit, config?.listLimit)));
  };
  return (
    <article className="home-widget-card-v484 custom" data-widget-size={size} data-detail-level={config?.detailLevel || "standard"}>
      <header><div><p className="eyebrow">Custom · {safe.version}</p><h3>{safe.name}</h3></div><span>declarative</span></header>
      {safe.description && !blocks.length && <p className="home-widget-custom-text-v484">{safe.description}</p>}
      {scopedAggregatesUnavailable && blocks.some((block) => ["metric", "status", "trend", "progress", "matrix", "operation"].includes(block.type)) &&
        <p className="home-widget-custom-text-v484" role="status">{Object.keys(scopedCounts.values).length ? "Only the labeled server-verified counts are complete. Other scoped metrics remain unavailable." : HOME_SCOPED_AGGREGATES_UNAVAILABLE} {scopedCounts.pending ? "Checking authorized counts…" : scopedCounts.error || ""}</p>}
      <div className="home-widget-custom-blocks-v484">
        {blocks.map((block, index) => {
          if (block.type === "text") return <p key={index} className="home-widget-custom-text-v484">{block.text}</p>;
          if (block.type === "metric") return <div key={index} className="home-widget-custom-metric-v484"><span>{block.label}</span><strong>{metricLabel(block.binding)}</strong></div>;
          if (block.type === "clock") return <div key={index} className="home-widget-custom-clock-v484"><span>{block.label || "Local time"}</span><strong>{formatClock(block.format, now)}</strong></div>;
          if (block.type === "list") return <ListBlock key={index} label={block.label} items={renderList(block.binding, block.limit)} />;
          if (block.type === "queue") return <ListBlock key={index} label={block.label || "Queue"} items={renderList(block.binding, block.limit)} emptyLabel="Queue clear" />;
          if (block.type === "people") return <ListBlock key={index} label={block.label || "People"} items={renderList(block.binding, block.limit)} emptyLabel="Nobody available" />;
          if (block.type === "timeline") return <ListBlock key={index} label={block.label || "Timeline"} items={renderList(block.binding, block.limit)} emptyLabel="No timeline items" />;
          if (block.type === "resource") return <ListBlock key={index} label={block.label || "Resources"} items={renderList(block.binding, block.limit)} emptyLabel="No recent resources" />;
          if (block.type === "dataView") return <ListBlock key={index} label={block.label} items={renderList(block.binding, block.limit)} emptyLabel="No rows" />;
          if (block.type === "status") {
            if (scopedAggregatesUnavailable && scopedMetricValue(block.binding) === undefined) return <div key={index} className="home-widget-custom-status-v504" data-tone="neutral"><span>{block.label}</span><strong>Not available</strong></div>;
            const value = numberValue(scopedMetricValue(block.binding));
            const tone = block.goodAt !== undefined && value <= block.goodAt ? "good" : block.warningAt !== undefined && value >= block.warningAt ? "warning" : value > 0 ? "danger" : "neutral";
            return <div key={index} className="home-widget-custom-status-v504" data-tone={tone}><span>{block.label}</span><strong>{metricLabel(block.binding)}</strong></div>;
          }
          if (block.type === "trend") {
            if (scopedAggregatesUnavailable && scopedMetricValue(block.binding) === undefined) return <div key={index} className="home-widget-custom-trend-v504"><span>{block.label}</span><strong>Not available</strong></div>;
            const value = numberValue(scopedMetricValue(block.binding));
            const direction = block.direction || "neutral";
            const glyph = value === 0 ? "→" : direction === "down-good" ? "↓" : direction === "up-good" ? "↑" : value > 0 ? "↑" : "↓";
            return <div key={index} className="home-widget-custom-trend-v504"><span>{block.label}</span><strong>{glyph} {metricLabel(block.binding)}</strong></div>;
          }
          if (block.type === "progress") {
            if (scopedAggregatesUnavailable) return <div key={index} className="home-widget-custom-progress-v504"><div><span>{block.label}</span><strong>Not available</strong></div></div>;
            const value = numberValue(data.metrics[block.value]);
            const total = Math.max(0, numberValue(data.metrics[block.total]));
            const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((value / total) * 100))) : 0;
            return <div key={index} className="home-widget-custom-progress-v504"><div><span>{block.label}</span><strong>{value}/{total}</strong></div><progress max={100} value={percent} aria-label={`${block.label}: ${percent}%`} /></div>;
          }
          if (block.type === "action") {
            const action = actions?.[block.target];
            return <div key={index} className="home-widget-custom-action-v504"><ClusterButton variant="quiet" size="compact" disabled={!action} onClick={action}>{block.label}</ClusterButton></div>;
          }
          if (block.type === "matrix") return <section key={index} className="home-widget-custom-matrix-v504"><strong>{block.label}</strong><div>{block.bindings.map((binding) => <span key={binding}><em>{binding.split(".").at(-1)}</em><b>{metricLabel(binding)}</b></span>)}</div></section>;
          if (block.type === "operation") return <section key={index} className="home-widget-custom-operation-v504"><div><span>{block.label}</span><strong>{metricLabel(block.binding)}</strong></div>{block.detailBinding && <ListBlock items={renderList(block.detailBinding, 3)} emptyLabel="No active operations" />}</section>;
          return null;
        })}
      </div>
      <footer className="home-widget-actions-v484">
        {config?.showActions === false ? null : primaryAction ? <ClusterButton variant="quiet" size="compact" onClick={primaryAction.onSelect}>{primaryAction.label}</ClusterButton> : onConfigure ? <ClusterButton variant="quiet" size="compact" onClick={onConfigure}>Configure widget</ClusterButton> : null}
      </footer>
    </article>
  );
}
