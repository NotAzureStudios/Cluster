import { useEffect, useRef, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { ClusterMetricStrip } from "../../components/ClusterMetricStrip";
import { RequestStatusLine } from "../../components/RequestState";
import { api } from "../../core/api";
import { downloadJsonFile } from "../../core/storage";
import { useVisibleRefresh } from "../../core/visible-refresh";

type SecurityFinding = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  remediation: string;
};

type SecurityPosture = {
  healthy: boolean;
  activeUsers: number;
  mfaEnabledUsers: number;
  mfaRequiredUsers: number;
  mfaEnrollmentGaps: number;
  mfaStrengthGaps: number;
  activeSessions: number;
  requiredSessionsWithoutMfa: number;
  registeredDevices: number;
  verifiedDevices: number;
  unverifiedDevices: number;
  activeCredentials: number;
  credentialRotationDue: number;
  credentialsWithoutExpiry: number;
  credentialScopePolicyViolations: number;
  credentialLifetimePolicyViolations: number;
  encryptionKeyConfigured: boolean;
  encryptionKeyId?: string | null;
  previousEncryptionKeyIds: string[];
  findings: SecurityFinding[];
};

type SecurityEvent = {
  id: string;
  event: string;
  result: string;
  reasonCode: string;
  occurredAt: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown> | null;
};

type IntegrityResult = {
  ok: boolean;
  checked?: number;
  writeFailures?: number;
  error?: string | null;
};

function timeLabel(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
}

function findingTone(severity: SecurityFinding["severity"]) {
  return severity === "critical" ? "danger" : severity === "warning" ? "warning" : "";
}

export function SecurityCenterPanel({ onOpenServerConfig }: { onOpenServerConfig?: () => void }) {
  const [posture, setPosture] = useState<SecurityPosture | null>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [status, setStatus] = useState("Loading Security Center...");
  const [exporting, setExporting] = useState(false);
  const loadingRef = useRef(false);

  async function load(silent = false) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) setStatus("Loading Security Center...");
    try {
      const [postureResult, eventResult, integrityResult] = await Promise.all([
        api<{ ok: true; posture: SecurityPosture }>("/api/admin/security/posture"),
        api<SecurityEvent[]>("/api/security/events?limit=40"),
        api<IntegrityResult>("/api/security/events/integrity"),
      ]);
      setPosture(postureResult.posture);
      setEvents(Array.isArray(eventResult) ? eventResult : []);
      setIntegrity(integrityResult);
      setStatus(`Security evidence refreshed ${new Date().toLocaleTimeString()}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Security Center could not be loaded.");
    } finally {
      loadingRef.current = false;
    }
  }

  useEffect(() => { void load(); }, []);
  useVisibleRefresh(() => load(true), { intervalMs: 30_000 });

  async function exportAuditEvidence() {
    setExporting(true);
    setStatus("Preparing security audit evidence...");
    try {
      const payload = await api<Record<string, unknown>>("/api/security/events/export?limit=1000");
      downloadJsonFile(`cluster-security-audit-${new Date().toISOString().slice(0, 10)}.json`, payload);
      setStatus("Security audit evidence exported.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Security audit export failed.");
    } finally {
      setExporting(false);
    }
  }

  function openSecurityConfig() {
    window.sessionStorage.setItem("cluster-server-config-section", "security");
    onOpenServerConfig?.();
  }

  const critical = posture?.findings.filter((finding) => finding.severity === "critical").length || 0;
  const warnings = posture?.findings.filter((finding) => finding.severity === "warning").length || 0;
  const failures = events.filter((event) => String(event.result).toUpperCase() === "FAILURE").length;

  return (
    <section className="panel security-center-v510" aria-labelledby="security-center-title-v510">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Admin 2.0</p>
          <h2 id="security-center-title-v510">Security Center</h2>
          <p className="muted tight">Security posture, audit-chain evidence, and recent security events. Policy changes stay in the guarded Server Configuration workflow rather than being reimplemented here.</p>
        </div>
        <div className="button-row">
          <ClusterButton type="button" variant="secondary" onClick={() => void load()} disabled={loadingRef.current}>Refresh</ClusterButton>
          <ClusterButton type="button" variant="secondary" onClick={() => void exportAuditEvidence()} disabled={exporting}>{exporting ? "Exporting…" : "Export evidence"}</ClusterButton>
          {onOpenServerConfig ? <ClusterButton type="button" variant="primary" onClick={openSecurityConfig}>Security policy</ClusterButton> : null}
        </div>
      </div>

      <ClusterMetricStrip
        label="Security posture summary"
        items={[
          { label: "Posture", value: posture?.healthy ? "Healthy" : posture ? "Needs attention" : "—", detail: `${critical} critical · ${warnings} warning`, tone: critical ? "danger" : warnings ? "warning" : posture?.healthy ? "good" : "neutral" },
          { label: "MFA", value: posture ? `${posture.mfaEnabledUsers}/${posture.activeUsers}` : "—", detail: `${posture?.mfaEnrollmentGaps || 0} enrollment gaps`, tone: posture?.mfaEnrollmentGaps ? "danger" : "good" },
          { label: "Sessions", value: posture?.activeSessions ?? "—", detail: `${posture?.requiredSessionsWithoutMfa || 0} noncompliant`, tone: posture?.requiredSessionsWithoutMfa ? "warning" : "good" },
          { label: "Devices", value: posture ? `${posture.verifiedDevices}/${posture.registeredDevices}` : "—", detail: "cryptographically verified", tone: posture?.unverifiedDevices ? "warning" : "good" },
          { label: "Credentials", value: posture?.activeCredentials ?? "—", detail: `${posture?.credentialRotationDue || 0} rotation due`, tone: posture?.credentialScopePolicyViolations || posture?.credentialLifetimePolicyViolations ? "danger" : posture?.credentialRotationDue ? "warning" : "good" },
          { label: "Audit chain", value: integrity?.ok ? "Verified" : integrity ? "Failed" : "—", detail: `${integrity?.checked || 0} checked · ${integrity?.writeFailures || 0} write failures`, tone: integrity?.ok ? "good" : integrity ? "danger" : "neutral" },
        ]}
      />

      <div className="admin-split-grid">
        <section className="panel">
          <header className="section-heading"><div><h3>Posture findings</h3><p className="muted tight">Concrete server-side policy and configuration findings with remediation guidance.</p></div></header>
          <div className="control-domain-list-v136">
            {(posture?.findings || []).map((finding) => <article key={finding.id} className={`control-domain-card-v136 ${findingTone(finding.severity)}`}>
              <div><strong>{finding.title}</strong><span>{finding.detail}</span><small>{finding.remediation}</small></div>
              <em>{finding.severity}</em>
            </article>)}
            {posture && !posture.findings.length ? <ClusterEmptyState compact kind="empty" title="No security findings" description="The current Studio security policy and server posture have no surfaced findings." /> : null}
          </div>
        </section>

        <section className="panel">
          <header className="section-heading"><div><h3>Recent security events</h3><p className="muted tight">Security audit events remain distinct from operational logs and ordinary activity history.</p></div><span className={`soft-pill ${failures ? "warning" : "good"}`}>{failures ? `${failures} failures loaded` : "No failures loaded"}</span></header>
          <div className="control-domain-list-v136">
            {events.slice(0, 20).map((event) => <article key={event.id} className={`control-domain-card-v136 ${String(event.result).toUpperCase() === "FAILURE" ? "danger" : "good"}`}>
              <div><strong>{event.event}</strong><span>{event.reasonCode} · {timeLabel(event.occurredAt)}{event.correlationId ? ` · trace ${event.correlationId}` : ""}</span></div>
              <em>{String(event.result).toLowerCase()}</em>
            </article>)}
            {!events.length ? <ClusterEmptyState compact kind="empty" title="No security events loaded" description="Security audit events will appear after protected actions are recorded." /> : null}
          </div>
        </section>
      </div>

      <RequestStatusLine>{status}</RequestStatusLine>
    </section>
  );
}
