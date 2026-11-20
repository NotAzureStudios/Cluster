import type { ReactNode } from "react";
import { ClusterButton } from "./ClusterButton";
import { ClusterIcon, type ClusterIconName } from "./ClusterIcon";
import "./cluster-pulse.css";

/* A row of indicator tiles: a tone dot or icon beside one number and a
   short word. Each tile can open where that number comes from. Used for
   at-a-glance summaries (admin dashboard, overviews). */
export type ClusterPulseItem = {
  id: string;
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: "good" | "warning" | "danger" | "accent" | "neutral";
  icon?: ClusterIconName;
  onSelect?: () => void;
};

export function ClusterPulse({ items, label }: { items: ClusterPulseItem[]; label: string }) {
  return <section className="cp" aria-label={label}>
    {items.map((item) => {
      const body = <>
        <span className="cp__viz" aria-hidden="true">{item.icon ? <ClusterIcon name={item.icon} /> : <i />}</span>
        <span className="cp__copy"><strong>{item.value}</strong><small>{item.label}{item.sub ? <em> · {item.sub}</em> : null}</small></span>
      </>;
      return item.onSelect
        ? <ClusterButton unstyled type="button" key={item.id} className="cp__tile" data-tone={item.tone || "neutral"} onClick={item.onSelect}>{body}</ClusterButton>
        : <div key={item.id} className="cp__tile" data-tone={item.tone || "neutral"}>{body}</div>;
    })}
  </section>;
}
