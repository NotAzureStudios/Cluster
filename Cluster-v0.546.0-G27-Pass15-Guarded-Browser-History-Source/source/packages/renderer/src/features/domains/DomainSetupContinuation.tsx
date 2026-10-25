import { useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ServerDomainsPanel, StudioDomainsPanel } from "./DomainManagementPanel";

/** Authenticated continuation of OOBE after Owner MFA enrollment. The initial
 * unauthenticated setup wizard only records a non-secret domain proposal. */
export function DomainSetupContinuation({ onRefresh, onClose }: { onRefresh: () => void; onClose: () => void }) {
  const [stage, setStage] = useState<"ownership" | "connect">("ownership");
  return <section className="cluster-panel" aria-label="Continue domain setup">
    <div className="section-heading"><div><h3>Finish domain setup</h3><p>
      Initial setup recorded your domain and preferred access method. An authenticated administrator must
      prove DNS ownership, bind this server, then deploy and check the gateway. No external service is changed automatically.
    </p></div><ClusterButton variant="quiet" onClick={onClose}>Close guide</ClusterButton></div>
    <nav className="cluster-form-row" aria-label="Domain setup steps">
      <ClusterButton variant={stage === "ownership" ? "primary" : "secondary"} onClick={() => setStage("ownership")}>1. Studio domain and DNS proof</ClusterButton>
      <ClusterButton variant={stage === "connect" ? "primary" : "secondary"} onClick={() => setStage("connect")}>2. Server binding and connectivity</ClusterButton>
    </nav>
    {stage === "ownership" ? <StudioDomainsPanel /> : <ServerDomainsPanel />}
    <div className="button-row">
      {stage === "ownership" ? <ClusterButton variant="primary" onClick={() => setStage("connect")}>Continue to server access</ClusterButton> :
        <ClusterButton variant="secondary" onClick={() => setStage("ownership")}>Back to Studio domains</ClusterButton>}
      <ClusterButton variant="quiet" onClick={onRefresh}>Refresh setup status</ClusterButton>
    </div>
    <p className="muted">Checklist completion reflects verified ownership, server binding and a saved access plan.
      It does not certify DNS propagation, installed gateway processes, HTTPS, remote reachability or Desktop sign-in.</p>
  </section>;
}
