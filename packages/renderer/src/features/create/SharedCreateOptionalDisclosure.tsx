import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import type { CreateModeGuidance } from "./create-mode-catalog";

export function SharedCreateOptionalDisclosure({
  open,
  guidance,
  onToggle,
}: {
  open: boolean;
  guidance: CreateModeGuidance;
  onToggle: () => void;
}) {
  return (
    <section className={`shared-create-disclosure-v495 shared-create-disclosure-compact-v521 full${open ? " open" : ""}`}>
      <span className="shared-create-required-v521" title={guidance.description}>{guidance.required}</span>
      <ClusterButton type="button" variant="quiet" size="compact" className="shared-create-advanced-toggle-v458" aria-expanded={open} onClick={onToggle}>
        <ClusterIcon name="settings" />
        <strong>{open ? "Fewer options" : "More options"}</strong>
        <ClusterIcon name={open ? "chevron-down" : "chevron-right"} />
      </ClusterButton>
    </section>
  );
}
