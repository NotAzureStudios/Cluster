import { useMemo } from "react";
import type { ProjectControlRecord } from "./project-control-model";

export function ProjectBudgetSummary({ records }: { records: ProjectControlRecord[] }) {
  const groups = useMemo(() => {
    const rows = new Map<string, { category: string; currency: string; planned: number; actual: number; forecast: number }>();
    for (const record of records.filter((item) => item.kind === "budget")) {
      const category = String(record.payload.costCategory || record.category || "General");
      const currency = String(record.payload.currency || "USD").toUpperCase();
      const key = `${currency}:${category}`;
      const row = rows.get(key) || { category, currency, planned: 0, actual: 0, forecast: 0 };
      row.planned += Number(record.payload.planned || 0); row.actual += Number(record.payload.actual || 0); row.forecast += Number(record.payload.forecast ?? record.payload.actual ?? 0); rows.set(key, row);
    }
    return [...rows.values()];
  }, [records]);
  if (!groups.length) return null;
  return <div className="project-budget-summary-v315"><header><strong>Budget variance</strong><span>{groups.length} cost categories</span></header><div>{groups.map((row) => { const variance = row.forecast - row.planned; const format = new Intl.NumberFormat(undefined, { style: "currency", currency: row.currency, maximumFractionDigits: 0 }); return <article key={`${row.currency}:${row.category}`} className={variance > 0 ? "danger" : "good"}><strong>{row.category}</strong><span>Planned {format.format(row.planned)}</span><span>Actual {format.format(row.actual)}</span><span>Forecast {format.format(row.forecast)}</span><em>{variance === 0 ? "On plan" : `${variance > 0 ? "+" : ""}${format.format(variance)} variance`}</em></article>; })}</div></div>;
}
