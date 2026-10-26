import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../../core/api";
import { compactDateTime } from "../../core/date-time";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { openPrivacyChoices } from "../../core/privacy-consent";
import type { User } from "../application/application-models";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";
import "./privacy-data-control.css";

type PrivacyCategory = { id: string; label: string; count: number; description: string };
type PrivacyRequest = { id: string; requestType: string; status: string; note?: string | null; resolutionNote?: string | null; requestedAt: string; resolvedAt?: string | null; cancelledAt?: string | null };
type PolicyAcceptanceRecord = { id: string; policyId: string; policyKind: string; policyVersion: string; policyContentHash: string; acceptanceMode: "acknowledge" | "accept" | string; acceptanceAudience: string; requirementHash: string; acceptedAt: string; source: string; evidenceHash: string };
type PrivacySummary = {
  ok: true;
  profile: Record<string, unknown>;
  connectedAccounts: Array<{ provider: string; linked: boolean; requiredByStudio: boolean; userId?: string | null; username?: string | null; displayName?: string | null; linkedAt?: string | null; lastVerifiedAt?: string | null; canDisconnect: boolean }>;
  privacyPolicy: { version: string; title: string; contentHash: string; effectiveAt?: string | null; publishedAt?: string | null } | null;
  policyAcceptances: PolicyAcceptanceRecord[];
  categories: PrivacyCategory[];
  requests: PrivacyRequest[];
  controls: { exportAvailable: boolean; exportRequiresRecentAuthentication: boolean; deletionIsRequestBased: boolean; deletionAutomatic: boolean; deletionFulfillmentAvailable?: boolean; maximumExportRecordsPerCategory: number };
};

type PrivacyExportResponse = { ok: true; filename: string; export: Record<string, unknown> };

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function friendlyError(error: unknown) {
  if (error instanceof ApiError) return error.userMessage;
  return error instanceof Error ? error.message : "Cluster could not complete the privacy action.";
}

export function PrivacyDataControlCenter({ currentUser }: { currentUser: User }) {
  const [summary, setSummary] = useState<PrivacySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const activeDeletion = useMemo(() => summary?.requests.find((item) => item.requestType === "deletion" && ["pending", "approved"].includes(item.status)) || null, [summary]);
  const pendingDeletion = activeDeletion?.status === "pending" ? activeDeletion : null;
  const discord = summary?.connectedAccounts.find((item) => item.provider === "discord") || null;
  const profileRows = useMemo(() => {
    const profile = summary?.profile || {};
    return [
      ["Username", profile.username],
      ["Display name", profile.displayName],
      ["Legal name", profile.legalName],
      ["Email", profile.email],
      ["Phone", profile.phoneNumber],
      ["Account type", profile.accountType],
      ["Timezone", profile.timezone],
      ["Location", [profile.city, profile.stateProvince, profile.country].filter(Boolean).join(", ")],
    ].filter((row) => row[1] !== null && row[1] !== undefined && String(row[1]).trim());
  }, [summary]);

  async function load() {
    setLoading(true);
    try {
      const result = await api<PrivacySummary>("/api/privacy/data-summary");
      setSummary(result);
      setStatus("");
    } catch (error) {
      setStatus(friendlyError(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [currentUser.id]);

  async function exportMyData() {
    setBusy("export");
    setStatus("");
    try {
      const result = await api<PrivacyExportResponse>("/api/privacy/data-export", { method: "POST", body: JSON.stringify({}) });
      downloadJson(result.filename, result.export);
      setStatus("Personal-data export created locally. Cluster did not store another copy of the export file.");
    } catch (error) {
      setStatus(friendlyError(error));
    } finally {
      setBusy(null);
    }
  }

  async function requestDeletion() {
    if (!await confirmCluster({ title: "Request account-data deletion?", message: "This creates a review request; it does not immediately delete records or bypass studio/legal retention requirements.", confirmLabel: "Request deletion", tone: "danger" })) return;
    setBusy("deletion");
    setStatus("");
    try {
      await api("/api/privacy/data-requests", {
        method: "POST",
        headers: { "X-Cluster-Confirmation": "REQUEST DATA DELETION" },
        body: JSON.stringify({ requestType: "deletion" }),
      });
      setStatus("Account-data deletion request submitted for review.");
      await load();
    } catch (error) {
      setStatus(friendlyError(error));
    } finally {
      setBusy(null);
    }
  }

  async function cancelDeletion() {
    if (!pendingDeletion || !await confirmCluster({ title: "Cancel deletion request?", message: "Cancel your pending account-data deletion request?", confirmLabel: "Cancel request" })) return;
    setBusy("cancel");
    setStatus("");
    try {
      await api(`/api/privacy/data-requests/${encodeURIComponent(pendingDeletion.id)}`, {
        method: "DELETE",
        headers: { "X-Cluster-Confirmation": "CANCEL DATA REQUEST" },
      });
      setStatus("Pending deletion request cancelled.");
      await load();
    } catch (error) {
      setStatus(friendlyError(error));
    } finally {
      setBusy(null);
    }
  }

  async function disconnectDiscord() {
    if (!discord?.linked || !discord.canDisconnect) return;
    if (!await confirmCluster({ title: "Disconnect Discord?", message: "For security, Cluster will revoke all current sessions and return you to sign in.", confirmLabel: "Disconnect Discord", tone: "danger" })) return;
    setBusy("discord");
    setStatus("");
    try {
      await api("/api/privacy/integrations/discord", { method: "DELETE", headers: { "X-Cluster-Confirmation": "DISCONNECT DISCORD" } });
      window.location.assign("/");
    } catch (error) {
      setStatus(friendlyError(error));
      setBusy(null);
    }
  }

  return (
    <div className="privacy-data-center-v364">
      <section className="settings-card-v092 span-2 privacy-data-overview-v364">
        <div className="settings-card-head-v092">
          <div><h3>Privacy & data control center</h3><p className="muted tight">See what Cluster associates with your account, export a bounded copy, manage connected identity, and submit data requests.</p></div>
          <ClusterButton type="button" className="" disabled={loading} onClick={() => void load()} variant="quiet" size="compact">{loading ? "Refreshing…" : "Refresh"}</ClusterButton>
        </div>
        {status && <div className="status-box system-status-box-v053">{status}</div>}
        <div className="privacy-control-actions-v364">
          <ClusterButton type="button" className="" disabled={busy === "export" || loading} onClick={() => void exportMyData()} variant="primary">{busy === "export" ? "Preparing export…" : "Download my data"}</ClusterButton>
          <ClusterButton type="button" className="" onClick={openPrivacyChoices} variant="secondary">Privacy choices</ClusterButton>
          <ClusterLinkButton variant="quiet" href="/legal/privacy">Privacy notice</ClusterLinkButton>
        </div>
        <p className="muted tight privacy-export-note-v364">Exports require a recent password confirmation and deliberately exclude password/PIN hashes, session-token hashes, server secrets, and raw security-audit evidence. Each record category is bounded to {summary?.controls.maximumExportRecordsPerCategory ?? 2500} records.</p>
      </section>

      <section className="settings-card-v092 span-2">
        <div className="settings-card-head-v092"><h3>Data associated with this account</h3><span>{summary ? `${summary.categories.reduce((total, item) => total + item.count, 0)} linked records` : "Loading"}</span></div>
        <div className="privacy-category-grid-v364">
          {(summary?.categories || []).map((category) => <article key={category.id}>
            <div><strong>{category.label}</strong><span>{category.description}</span></div>
            <b>{category.count.toLocaleString()}</b>
          </article>)}
          {!loading && !summary && <div className="empty-state compact-empty">Data inventory unavailable.</div>}
        </div>
      </section>

      <section className="settings-card-v092 span-2 privacy-profile-snapshot-v364">
        <div className="settings-card-head-v092"><h3>Stored profile snapshot</h3><span>Self-service view</span></div>
        <div className="privacy-profile-grid-v364">
          {profileRows.map(([label, value]) => <div key={String(label)}><span>{String(label)}</span><strong>{String(value)}</strong></div>)}
          {!profileRows.length && <div className="empty-state compact-empty">No profile fields are available.</div>}
        </div>
        <p className="muted tight">The downloadable export contains the broader account/profile field set. Credential hashes are never included.</p>
      </section>

      <section className="settings-card-v092 privacy-connected-v364">
        <div className="settings-card-head-v092"><h3>Connected identity</h3><span>{discord?.linked ? "Discord linked" : "No Discord link"}</span></div>
        {discord?.linked ? <>
          <div className="privacy-identity-row-v364">
            <div className="privacy-provider-mark-v364">D</div>
            <div><strong>{discord.displayName || discord.username || "Discord account"}</strong><span>{discord.username ? `@${discord.username}` : discord.userId || "Linked identity"}</span><em>Linked {discord.linkedAt ? compactDateTime(discord.linkedAt) : "previously"}</em></div>
          </div>
          {discord.requiredByStudio
            ? <p className="muted tight">This studio requires Discord linking, so self-service disconnect is disabled.</p>
            : <ClusterButton type="button" className="" disabled={busy === "discord"} onClick={() => void disconnectDiscord()} variant="danger">{busy === "discord" ? "Disconnecting…" : "Disconnect Discord"}</ClusterButton>}
        </> : <p className="muted">No external identity is currently linked to your Cluster account.</p>}
      </section>

      <section className="settings-card-v092 privacy-request-v364">
        <div className="settings-card-head-v092"><h3>Account-data deletion</h3><span>{activeDeletion ? (activeDeletion.status === "approved" ? "Approved" : "Request pending") : "No active request"}</span></div>
        <p className="muted">Deletion is request-based. Approved requests are fulfilled by pseudonymizing direct account identity and revoking access while preserving work, security, policy, legal-hold, and fulfillment evidence that must remain attributable.</p>
        {activeDeletion ? <>
          <div className="privacy-request-state-v364"><strong>Requested {compactDateTime(activeDeletion.requestedAt)}</strong><span>{activeDeletion.status === "approved" ? "Approved for operator fulfillment" : "Pending review"}</span></div>
          {pendingDeletion && <ClusterButton type="button" className="" disabled={busy === "cancel"} onClick={() => void cancelDeletion()} variant="secondary">{busy === "cancel" ? "Cancelling…" : "Cancel request"}</ClusterButton>}
        </> : <ClusterButton type="button" className="" disabled={busy === "deletion"} onClick={() => void requestDeletion()} variant="danger">{busy === "deletion" ? "Submitting…" : "Request account-data deletion"}</ClusterButton>}
        {summary?.requests.length ? <div className="privacy-request-history-v364">
          {summary.requests.slice(0, 4).map((item) => <div key={item.id}><span>{item.requestType.replace(/-/g, " ")}</span><strong>{item.status}</strong><em>{compactDateTime(item.requestedAt)}</em></div>)}
        </div> : null}
      </section>

      <section className="settings-card-v092 span-2 privacy-policy-state-v364">
        <div className="settings-card-head-v092"><h3>Current privacy notice</h3><span>{summary?.privacyPolicy ? `v${summary.privacyPolicy.version}` : "Not published"}</span></div>
        {summary?.privacyPolicy ? <div className="privacy-policy-meta-v364"><div><strong>{summary.privacyPolicy.title}</strong><span>Effective {summary.privacyPolicy.effectiveAt ? compactDateTime(summary.privacyPolicy.effectiveAt) : "now"}</span></div><code>{summary.privacyPolicy.contentHash.slice(0, 16)}…</code></div> : <p className="muted">This server has not published an effective privacy notice yet.</p>}
        {summary?.policyAcceptances?.length ? <div className="privacy-request-history-v364 policy-acceptance-history-v378">
          {summary.policyAcceptances.slice(0, 8).map((item) => <div key={item.id}>
            <span>{item.policyKind.replace(/_/g, " ")} v{item.policyVersion}</span>
            <strong>{item.acceptanceMode === "acknowledge" ? "Acknowledged" : "Accepted"}</strong>
            <em>{compactDateTime(item.acceptedAt)} · {item.evidenceHash.slice(0, 12)}…</em>
          </div>)}
        </div> : <p className="muted tight">No policy acknowledgement or acceptance evidence is stored for this account yet.</p>}
        <p className="muted tight">Acceptance evidence is tied to the exact immutable policy version and content hash and is included in your personal-data export.</p>
      </section>
    </div>
  );
}
