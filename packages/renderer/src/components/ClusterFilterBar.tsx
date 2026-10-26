import type { HTMLAttributes, ReactNode } from "react";

export function ClusterFilterBar({ label = "Filters", className = "", children, ...props }: HTMLAttributes<HTMLDivElement> & { label?: string; children: ReactNode }) {
  return <div {...props} className={`cluster-data-filters-v289 cluster-filter-bar-v537 ${className}`.trim()} role="group" aria-label={label}>{children}</div>;
}
