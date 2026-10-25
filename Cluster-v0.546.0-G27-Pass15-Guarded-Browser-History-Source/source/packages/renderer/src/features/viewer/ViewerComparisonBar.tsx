import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterSlider } from "../../components/ClusterSlider";
import { comparisonModesForMedium, type ReviewComparisonSession, type ReviewComparisonSnapshot } from "./review-comparison-session";

const MODE_LABELS = {
  side: "Side by side",
  wipe: "Wipe",
  overlay: "Overlay",
  difference: "Difference",
  blink: "Blink A/B",
  reference: "Reference overlay",
  ab: "A/B monitor",
  off: "Off",
} as const;

export function ViewerComparisonBar({
  session,
  snapshot,
  primaryLabel = "A",
  secondaryLabel = "B",
}: {
  session: ReviewComparisonSession;
  snapshot: ReviewComparisonSnapshot;
  primaryLabel?: string;
  secondaryLabel?: string;
}) {
  if (!snapshot.enabled) return null;
  const modes = comparisonModesForMedium(snapshot.medium);
  const amountVisible = ["wipe", "overlay", "difference", "reference"].includes(snapshot.mode);
  return <div className="cluster-viewer-comparison-bar" role="group" aria-label={`${snapshot.medium} comparison controls`}>
    <div className="cluster-viewer-comparison-identities"><span><b>A</b>{primaryLabel}</span><span><b>B</b>{secondaryLabel}</span></div>
    {modes.length > 1 ? <label><span>Mode</span><ClusterNativeSelect aria-label="Comparison mode" value={snapshot.mode} onChange={(event) => session.setMode(event.target.value as typeof snapshot.mode)}>{modes.map((mode) => <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>)}</ClusterNativeSelect></label> : <span className="cluster-viewer-comparison-mode">{MODE_LABELS[snapshot.mode]}</span>}
    {snapshot.mode === "ab" ? <div className="cluster-viewer-comparison-ab" role="group" aria-label="A/B monitor source"><ClusterButton size="compact" variant="quiet" selected={snapshot.activeSide === "primary"} onClick={() => session.setActiveSide("primary")}>A</ClusterButton><ClusterButton size="compact" variant="quiet" selected={snapshot.activeSide === "secondary"} onClick={() => session.setActiveSide("secondary")}>B</ClusterButton></div> : null}
    {amountVisible ? <label className="cluster-viewer-comparison-amount"><span>{snapshot.mode === "wipe" ? "Wipe" : snapshot.mode === "reference" ? "Reference" : "Blend"}</span><ClusterSlider aria-label="Comparison amount" min="10" max="90" step="1" value={snapshot.amount} onChange={(event) => session.setAmount(Number(event.target.value))} /><output>{Math.round(snapshot.amount)}%</output></label> : null}
    {snapshot.mode === "blink" ? <label><span>Blink</span><ClusterNativeSelect aria-label="Blink interval" value={String(snapshot.blinkIntervalMs)} onChange={(event) => session.setBlinkIntervalMs(Number(event.target.value))}><option value="300">Fast</option><option value="650">Normal</option><option value="1200">Slow</option></ClusterNativeSelect></label> : null}
    {snapshot.medium === "video" || snapshot.medium === "audio" ? <label className="cluster-viewer-comparison-toggle"><ClusterInput type="checkbox" checked={snapshot.syncPlayback} onChange={(event) => session.setSyncPlayback(event.target.checked)} /><span>Sync transport</span></label> : null}
    {snapshot.medium === "3d" ? <label className="cluster-viewer-comparison-toggle"><ClusterInput type="checkbox" checked={snapshot.syncCamera} onChange={(event) => session.setSyncCamera(event.target.checked)} /><span>Sync camera</span></label> : null}
  </div>;
}
