import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../core/api";
import { PrivacyPolicyAdminPanel } from "./PrivacyPolicyAdminPanel";
import { PrivacyConsentAdminPanel } from "./PrivacyConsentAdminPanel";
import { DataRetentionAdminPanel } from "./DataRetentionAdminPanel";
import { PrivacyRequestsAdminPanel } from "./PrivacyRequestsAdminPanel";
import { ThirdPartyDisclosureAdminPanel } from "./ThirdPartyDisclosureAdminPanel";
import { BehavioralAnalyticsAdminPanel } from "./BehavioralAnalyticsAdminPanel";
import "./legal-compliance-center.css";
import { ClusterButton } from "../../components/ClusterButton";

type PrivacyArea = "overview" | "notice" | "data" | "integrations";
type PolicyState = {
  key: string;
  label: string;
  publicPath: string;
  current: null | { version: string; effectiveAt?: string | null; publishedAt?: string | null };
  draftCount: number;
};
type ComplianceSnapshot = {
  policies: PolicyState[];
  privacy: {
    pendingDataRequests: number;
    consentRecords: number;
    analyticsProviders: number;
    externalProviders: number;
    thirdPartyDisclosure: { configured: number; public: number; unreviewed: number; detected: number; detectedNotRecorded: number };
    retentionPolicies: Array<{ category: string; enabled: boolean; retentionDays: number }>;
  };
  warnings: Array<{ key: string; severity: "info" | "warning"; title: string; detail: string; area: string }>;
};

const AREAS: Array<{ key: PrivacyArea; label: string; detail: string }> = [
  { key: "overview", label: "Overview", detail: "Internal data posture" },
  { key: "notice", label: "Privacy notice", detail: "What the team is told" },
  { key: "data", label: "Data & retention", detail: "Requests · retention · consent" },
  { key: "integrations", label: "Integrations", detail: "External data recipients" },
];

function formatDate(value?: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function LegalComplianceCenter() {
  const [area, setArea] = useState<PrivacyArea>("overview");
  const [snapshot, setSnapshot] = useState<ComplianceSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ ok: true; compliance: ComplianceSnapshot }>("/api/admin/legal/compliance");
      setSnapshot(result.compliance);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Privacy and data status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const privacyPolicy = useMemo(() => snapshot?.policies.find((policy) => policy.key === "privacy") || null, [snapshot]);
  const privacyWarnings = useMemo(() => (snapshot?.warnings || []).filter((warning) => warning.area === "privacy" || warning.key.startsWith("privacy")), [snapshot]);
  const enabledRetention = useMemo(() => (snapshot?.privacy.retentionPolicies || []).filter((policy) => policy.enabled), [snapshot]);

  return <div className="legal-compliance-center-v376">
    <div className="settings-panel-head-v092 legal-compliance-head-v376">
      <div>
        <p className="eyebrow">Internal administration</p>
        <h2>Privacy & data</h2>
        <p className="muted tight">Controls that matter for Cluster as proprietary, self-hosted team software: the internal privacy notice, account-data requests, retention, optional browser features, and enabled integrations.</p>
      </div>
      <div className="legal-compliance-head-actions-v381"><ClusterButton className="" type="button" onClick={() => void load()} disabled={loading} variant="secondary">{loading ? "Refreshing…" : "Refresh status"}</ClusterButton></div>
    </div>

    <div className="legal-compliance-disclaimer-v376"><strong>Private deployment.</strong><span>Cluster is treated here as internal organization software, not a public SaaS product. Public-service terms, operator agreements, consumer copyright workflows, and marketing-style privacy controls are intentionally kept out of the normal admin experience.</span></div>
    {message && <div className="legal-compliance-message-v376" role="status">{message}</div>}

    <div className="legal-compliance-layout-v376">
      <nav className="legal-compliance-nav-v376" aria-label="Privacy and data areas">
        {AREAS.map((item) => <ClusterButton unstyled key={item.key} type="button" className={area === item.key ? "active" : ""} onClick={() => setArea(item.key)} aria-current={area === item.key ? "page" : undefined}><strong>{item.label}</strong><span>{item.detail}</span></ClusterButton>)}
      </nav>

      <div className="legal-compliance-workspace-v376">
        {area === "overview" && <>
          <div className="legal-compliance-kpis-v376">
            <article><span>Privacy notice</span><strong>{privacyPolicy?.current ? `v${privacyPolicy.current.version}` : "Draft"}</strong><small>{privacyPolicy?.current ? `Effective ${formatDate(privacyPolicy.current.effectiveAt || privacyPolicy.current.publishedAt)}` : `${privacyPolicy?.draftCount || 0} unpublished version${privacyPolicy?.draftCount === 1 ? "" : "s"}`}</small></article>
            <article><span>Data requests</span><strong>{snapshot?.privacy.pendingDataRequests ?? "…"}</strong><small>Waiting for admin review</small></article>
            <article><span>Retention rules</span><strong>{enabledRetention.length || "…"}</strong><small>Enabled data categories</small></article>
            <article><span>Integrations</span><strong>{snapshot ? snapshot.privacy.analyticsProviders + snapshot.privacy.externalProviders : "…"}</strong><small>Configured external/analytics providers</small></article>
          </div>

          <section className="settings-card-v092 legal-compliance-status-card-v376">
            <div className="settings-card-head-v092"><h3>Internal-use baseline</h3><span>Proprietary</span></div>
            <div className="legal-policy-summary-v376">
              <article><div><strong>Login and navigation</strong><span>Minimal legal UI</span></div><small>Only the privacy notice is exposed during sign-in. The sidebar no longer carries a consumer-site legal footer.</small></article>
              <article><div><strong>Data transparency</strong><span>Keep</span></div><small>Account data inventory, exports, retention, activity/audit handling, and administrator access remain first-class controls.</small></article>
              <article><div><strong>Third-party software</strong><span>Release artifact</span></div><small>Dependency/license obligations belong with release and deployment records rather than the sign-in experience.</small></article>
            </div>
          </section>

          <section className="settings-card-v092">
            <div className="settings-card-head-v092"><h3>Needs attention</h3><span>{privacyWarnings.length}</span></div>
            {privacyWarnings.length ? <div className="legal-compliance-warning-list-v376">{privacyWarnings.map((warning) => <ClusterButton unstyled type="button" key={warning.key} onClick={() => setArea(warning.key.includes("third") || warning.key.includes("analytics") ? "integrations" : warning.key.includes("retention") || warning.key.includes("request") ? "data" : "notice")}><span className={`legal-warning-dot-v376 ${warning.severity}`} /><span><strong>{warning.title}</strong><small>{warning.detail}</small></span></ClusterButton>)}</div> : <div className="empty-state compact-empty">No privacy or data configuration warnings.</div>}
          </section>
        </>}

        {area === "notice" && <div className="legal-compliance-stack-v376"><PrivacyPolicyAdminPanel /></div>}
        {area === "data" && <div className="legal-compliance-stack-v376"><PrivacyRequestsAdminPanel /><DataRetentionAdminPanel /><PrivacyConsentAdminPanel /></div>}
        {area === "integrations" && <div className="legal-compliance-stack-v376"><ThirdPartyDisclosureAdminPanel /><BehavioralAnalyticsAdminPanel /></div>}
      </div>
    </div>
  </div>;
}
