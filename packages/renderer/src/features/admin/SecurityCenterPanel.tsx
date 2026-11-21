import { useEffect, useRef, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { api } from "../../core/api";
import { downloadJsonFile } from "../../core/storage";
import { useVisibleRefresh } from "../../core/visible-refresh";
import "./admin-ops.css";

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
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Unknown";
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

  const chips: Array<{ label: string; value: string | number; tone: string; title?: string }> = [
    { label: "Posture", value: posture?.healthy ? "Healthy" : posture ? `${critical + warnings} findings` : "—", tone: critical ? "danger" : warnings ? "warning" : posture?.healthy ? "good" : "" },
    { label: "MFA", value: posture ? `${posture.mfaEnabledUsers}/${posture.activeUsers}` : "—", tone: posture?.mfaEnrollmentGaps ? "danger" : "good", title: `${posture?.mfaEnrollmentGaps || 0} enrollment gaps` },
    { label: "Sessions", value: posture?.activeSessions ?? "—", tone: posture?.requiredSessionsWithoutMfa ? "warning" : "good", title: `${posture?.requiredSessionsWithoutMfa || 0} without required MFA` },
    { label: "Devices", value: posture ? `${posture.verifiedDevices}/${posture.registeredDevices}` : "—", tone: posture?.unverifiedDevices ? "warning" : "good", title: "Cryptographically verified" },
    { label: "Credentials", value: posture?.activeCredentials ?? "—", tone: posture?.credentialScopePolicyViolations || posture?.credentialLifetimePolicyViolations ? "danger" : posture?.credentialRotationDue ? "warning" : "good", title: `${posture?.credentialRotationDue || 0} due for rotation` },
    { label: "Audit chain", value: integrity?.ok ? "Verified" : integrity ? "Failed" : "—", tone: integrity?.ok ? "good" : integrity ? "danger" : "", title: `${integrity?.checked || 0} checked · ${integrity?.writeFailures || 0} write failures` },
  ];

  return (
    <section className="ao security-center-v510" aria-label="Security Center">
      <div className="ao-bar">
        <div className="ao-chips">{chips.map((chip) => <span key={chip.label} className="ao-chip" data-tone={chip.tone || undefined} title={chip.title}><span>{chip.label}</span><b>{chip.value}</b></span>)}</div>
        <span className="ao-bar__end">
          <ClusterButton type="button" size="compact" variant="quiet" onClick={() => void exportAuditEvidence()} disabled={exporting}>{exporting ? "Exporting…" : "Export evidence"}</ClusterButton>
          {onOpenServerConfig ? <ClusterButton type="button" size="compact" variant="secondary" onClick={openSecurityConfig}>Security policy</ClusterButton> : null}
        </span>
      </div>

      <div className="ao-grid">
        <section className="ao-card" aria-label="Findings">
          <h3 className="ao-card__title">Findings <small>{posture?.findings.length ?? ""}</small></h3>
          {posture?.findings.length ? <ul className="ao-rows">
            {posture.findings.map((finding) => <li key={finding.id} className="ao-row" data-tone={findingTone(finding.severity) || "accent"}>
              <i className="ao-dot" aria-hidden="true" />
              <span className="ao-row__main"><b title={finding.title}>{finding.title}</b><small className="ao-wrap">{finding.remediation || finding.detail}</small></span>
              <span className="ao-pill" title={finding.detail}>{finding.severity}</span>
            </li>)}
          </ul> : <p className="ao-empty">{posture ? "No findings." : status}</p>}
        </section>

        <section className="ao-card" aria-label="Security events">
          <h3 className="ao-card__title">Recent events {failures ? <span className="ao-pill" data-tone="warning">{failures} failed</span> : null}</h3>
          {events.length ? <ul className="ao-rows">
            {events.slice(0, 20).map((event) => {
              const failed = String(event.result).toUpperCase() === "FAILURE";
              return <li key={event.id} className="ao-row" data-tone={failed ? "danger" : "good"}>
                <i className="ao-dot" aria-hidden="true" />
                <span className="ao-row__main"><b>{event.event.replace(/[._]/g, " ")}</b><small title={event.correlationId ? `trace ${event.correlationId}` : undefined}>{event.reasonCode.replace(/_/g, " ").toLowerCase()}</small></span>
                <span className="ao-row__end"><small>{timeLabel(event.occurredAt)}</small></span>
              </li>;
            })}
          </ul> : <p className="ao-empty">No events yet.</p>}
        </section>
      </div>
    </section>
  );
}
