import { useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { HealthStrip, TrendIndicator } from "../../components/ClusterVisualIntelligence";
import type { VisualDatum } from "../../components/visual-intelligence";
import {
  clearPerformanceMetrics,
  downloadPerformanceReport,
  performanceSummary,
  type ClientPerformanceHealthCheck,
  type PerformanceSummary,
} from "../../core/performance";
import "./client-performance.css";
import "./operations-workspaces.css";
import { useVisibleRefresh } from "../../core/visible-refresh";

function formatBytes(value: number | null) {
  if (!value) return "Unavailable";
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`;
  return `${Math.round(value / 1024 ** 2)} MB`;
}

function healthValue(check: ClientPerformanceHealthCheck) {
  if (check.actual == null) return "No sample";
  if (check.unit === "ms") return `${Math.round(check.actual)} ms`;
  if (check.unit === "ratio") return `${Math.round(check.actual * 1000) / 10}%`;
  if (check.unit === "MiB") return `${Math.round(check.actual)} MiB`;
  return `${Math.round(check.actual * 10) / 10} ${check.unit}`;
}

function healthTarget(check: ClientPerformanceHealthCheck) {
  if (check.unit === "ratio") return `${Math.round(check.target * 1000) / 10}%`;
  if (check.unit === "ms") return `${check.target} ms`;
  if (check.unit === "MiB") return `${check.target} MiB`;
  return `${check.target} ${check.unit}`;
}

export function ClientPerformancePanel({ compact = false }: { compact?: boolean }) {
  const [summary, setSummary] = useState<PerformanceSummary>(() => performanceSummary());
  useVisibleRefresh(() => setSummary(performanceSummary()), { intervalMs: compact ? 20_000 : 10_000, requireOnline: false });
  const categories = ["navigation", "network", "render", "search", "sync", "interaction"] as const;
  const knownChecks = summary.health.checks.filter((check) => check.status !== "unknown");
  const clientHealth: VisualDatum[] = [
    { id: "startup", label: "First frame", value: summary.startup.firstFrameMs || 0, detail: summary.startup.firstFrameMs == null ? "No sample" : `${summary.startup.firstFrameMs} ms`, tone: summary.startup.firstFrameMs == null ? "neutral" : summary.startup.firstFrameMs <= 1000 ? "success" : summary.startup.firstFrameMs <= 2500 ? "warning" : "danger" },
    { id: "interaction", label: "INP", value: summary.webVitals.inpMs || 0, detail: summary.webVitals.inpMs == null ? "No sample" : `${summary.webVitals.inpMs} ms`, tone: summary.webVitals.inpMs == null ? "neutral" : summary.webVitals.inpMs <= 200 ? "success" : summary.webVitals.inpMs <= 500 ? "warning" : "danger" },
    { id: "cache", label: "Cache hit", value: summary.cache.hitRate, detail: summary.cache.requests ? `${summary.cache.hitRate}%` : "No requests", tone: summary.cache.requests ? (summary.cache.hitRate >= 80 ? "success" : summary.cache.hitRate >= 50 ? "warning" : "danger") : "neutral" },
    { id: "render", label: "React commits", value: summary.renderHealth.commits, detail: `${summary.renderHealth.averageActualMs} ms average`, tone: summary.renderHealth.maximumActualMs > 50 ? "warning" : "success" },
  ];
  return (
    <section className={`client-performance-v304 ${compact ? "compact" : ""}`}>
      <header>
        <div>
          <strong>Client performance</strong>
          <span>{summary.count} samples · {summary.health.failures} fail · {summary.health.warnings} warn · {summary.health.status} posture</span>
        </div>
        <div className="button-row">
          <ClusterButton variant="quiet" size="compact" onClick={() => { clearPerformanceMetrics(); setSummary(performanceSummary()); }}>Clear</ClusterButton>
          <ClusterButton variant="secondary" size="compact" onClick={downloadPerformanceReport}>Export profile</ClusterButton>
        </div>
      </header>
      <div className="operations-visual-intelligence-v504">
        <HealthStrip items={clientHealth} label="Client operational health" />
        {summary.webVitals.inpMs != null && summary.webVitals.fcpMs != null ? <TrendIndicator label="Interaction versus first content" current={summary.webVitals.inpMs} previous={summary.webVitals.fcpMs} /> : null}
      </div>
      <div className="client-performance-vitals-v304">
        <article><span>{summary.startup.classification} first frame</span><strong>{summary.startup.firstFrameMs == null ? "—" : `${summary.startup.firstFrameMs} ms`}</strong></article>
        <article><span>FCP / LCP</span><strong>{summary.webVitals.fcpMs == null ? "—" : `${summary.webVitals.fcpMs} ms`} / {summary.webVitals.lcpMs == null ? "—" : `${summary.webVitals.lcpMs} ms`}</strong></article>
        <article><span>INP / CLS</span><strong>{summary.webVitals.inpMs == null ? "—" : `${summary.webVitals.inpMs} ms`} / {summary.webVitals.cls}</strong></article>
        <article><span>Cache hit</span><strong>{summary.cache.requests ? `${summary.cache.hitRate}%` : "—"}</strong><small>{summary.cache.hits} hit · {summary.cache.misses} miss</small></article>
        <article><span>API chatter</span><strong>{summary.sessionAgeMs < 60_000 ? "Sampling…" : `${summary.health.requestRatePerMinute}/min`}</strong></article>
        <article><span>Long tasks</span><strong>{summary.sessionAgeMs < 60_000 ? "Sampling…" : `${summary.health.longTasksPerMinute}/min`}</strong></article>
        <article><span>Heap</span><strong>{formatBytes(summary.memory.usedBytes)}</strong></article>
        <article><span>React commits</span><strong>{summary.renderHealth.commits}</strong><small>{summary.renderHealth.averageActualMs} ms avg · {summary.renderHealth.maximumActualMs} ms max</small></article>
      </div>
      {!compact && (
        <>
          <div className="client-performance-categories-v304">
            {categories.map((category) => {
              const metric = summary.byCategory[category];
              const violation = summary.violations.find((item) => item.category === category);
              return (
                <article key={category} className={violation ? "warning" : ""}>
                  <span>{category}</span>
                  <strong>{metric ? `${metric.p95Ms} ms p95` : "No samples"}</strong>
                  <small>{metric ? `${metric.count} samples · ${metric.maximumMs} ms max` : "Use the application to collect this profile."}</small>
                  {violation && <em>Category budget {violation.p95Ms} ms · +{violation.overByMs} ms</em>}
                </article>
              );
            })}
          </div>
          <div className="client-performance-health-v440" aria-label="Client release performance budgets">
            {knownChecks.map((check) => (
              <article key={check.key} data-status={check.status} title={check.detail}>
                <span>{check.label}</span>
                <strong>{healthValue(check)}</strong>
                <small>Target {check.direction === "max" ? "≤" : "≥"} {healthTarget(check)}</small>
              </article>
            ))}
            {!knownChecks.length ? <small>Use Cluster for a few minutes to collect enough samples for release-budget posture.</small> : null}
          </div>
        </>
      )}
    </section>
  );
}
