import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";

/** Quiet toggle at the end of the form for the less common fields. */
export function SharedCreateOptionalDisclosure({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <ClusterButton type="button" variant="quiet" size="compact" className="shared-create-more-v600 full" aria-expanded={open} onClick={onToggle}>
      {open ? "Fewer options" : "More options"}
      <ClusterIcon name={open ? "chevron-up" : "chevron-down"} />
    </ClusterButton>
  );
}
