import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../core/api";
import { ClusterInput } from "../../components/ClusterNativeControls";
import {
  PRIVACY_CHOICES_OPEN_EVENT, PRIVACY_CONSENT_CHANGED_EVENT, PRIVACY_CONSENT_NOTICE_VERSION,
  clearOptionalPreferenceStorage, readPrivacyConsent, writePrivacyConsent, type PrivacyConsentState,
} from "../../core/privacy-consent";
import "./privacy-consent.css";
import { ClusterButton } from "../../components/ClusterButton";

type ConsentConfig = {
  ok: true; schemaVersion: number; noticeVersion: string;
  categories: Array<{ id: string; label: string; required: boolean; available: boolean; description: string }>;
  storage: Record<string, Array<Record<string, unknown>>>;
  externalProviders: Array<{ id: string; category: string; host: string; purpose: string }>;
  analyticsProviders: Array<{ id: string; name: string; purpose: string; dataCategories: string[]; retentionDays: number; firstParty: boolean; externalRecipient: boolean }>;
};
type ServerConsent = { schemaVersion: number; noticeVersion: string; preferences: boolean; analytics: boolean; externalContent: boolean; source: string; decidedAt: string; updatedAt: string };
const FALLBACK_CATEGORIES: ConsentConfig["categories"] = [
  { id: "necessary", label: "Strictly necessary", required: true, available: true, description: "Required for authentication, security, offline synchronization, recovery, and core navigation." },
  { id: "preferences", label: "Preferences", required: false, available: true, description: "Remembers interface, media, and local personalization choices." },
  { id: "analytics", label: "Analytics", required: false, available: false, description: "Optional analytics are unavailable unless this server has an administrator-reviewed analytics configuration." },
  { id: "externalContent", label: "External content", required: false, available: true, description: "Allows embedded content from external providers such as YouTube." },
];
function hostSource() { return typeof window !== "undefined" && window.clusterDesktop ? "desktop" : "web"; }

export function PrivacyConsentManager() {
  const initial = readPrivacyConsent();
  const [consent, setConsent] = useState<PrivacyConsentState>(initial);
  const [config, setConfig] = useState<ConsentConfig | null>(null);
  const [open, setOpen] = useState(() => !initial.decided);
  const [customize, setCustomize] = useState(false);
  const [draft, setDraft] = useState(() => ({ preferences: initial.preferences, analytics: initial.analytics, externalContent: initial.externalContent }));
  const [saving, setSaving] = useState(false);
  const authenticatedUserIdRef = useRef<string | null>(null);
  const categories = config?.categories || FALLBACK_CATEGORIES;
  const analyticsAvailable = useMemo(() => categories.some((category) => category.id === "analytics" && category.available), [categories]);

  const loadConsentConfig = useCallback(() => {
    if (config) return;
    void api<ConsentConfig>("/api/public/privacy/consent-config").then(setConfig).catch(() => undefined);
  }, [config]);

  const syncServerConsent = useCallback(async (userId: string | null) => {
    if (!userId) return;
    try {
      const response = await api<{ ok: true; currentNoticeVersion: string; consent: ServerConsent | null }>("/api/privacy/consent");
      if (response.consent?.noticeVersion === PRIVACY_CONSENT_NOTICE_VERSION) {
        const next = writePrivacyConsent({ preferences: response.consent.preferences, analytics: response.consent.analytics, externalContent: response.consent.externalContent, decidedAt: response.consent.decidedAt });
        setConsent(next); setDraft({ preferences: next.preferences, analytics: next.analytics, externalContent: next.externalContent }); setOpen(false); return;
      }
      const local = readPrivacyConsent();
      if (local.decided) await api("/api/privacy/consent", { method: "PUT", body: JSON.stringify({ preferences: local.preferences, analytics: local.analytics, externalContent: local.externalContent, noticeVersion: PRIVACY_CONSENT_NOTICE_VERSION, source: hostSource() }) });
    } catch {}
  }, []);

  useEffect(() => {
    if (!initial.decided) loadConsentConfig();
    const openChoices = () => { const current = readPrivacyConsent(); setConsent(current); setDraft({ preferences: current.preferences, analytics: current.analytics, externalContent: current.externalContent }); setCustomize(true); setOpen(true); loadConsentConfig(); };
    const identityChanged = (event: Event) => {
      const userId = String((event as CustomEvent<{ userId?: string | null }>).detail?.userId || "") || null;
      authenticatedUserIdRef.current = userId;
      void syncServerConsent(userId);
    };
    const consentChanged = (event: Event) => setConsent((event as CustomEvent<PrivacyConsentState>).detail || readPrivacyConsent());
    window.addEventListener(PRIVACY_CHOICES_OPEN_EVENT, openChoices); window.addEventListener("cluster:identity-changed", identityChanged); window.addEventListener(PRIVACY_CONSENT_CHANGED_EVENT, consentChanged);
    return () => { window.removeEventListener(PRIVACY_CHOICES_OPEN_EVENT, openChoices); window.removeEventListener("cluster:identity-changed", identityChanged); window.removeEventListener(PRIVACY_CONSENT_CHANGED_EVENT, consentChanged); };
  }, [initial.decided, loadConsentConfig, syncServerConsent]);

  async function save(next: { preferences: boolean; analytics: boolean; externalContent: boolean }) {
    setSaving(true);
    const normalized = { ...next, analytics: analyticsAvailable && next.analytics };
    const saved = writePrivacyConsent(normalized);
    if (!saved.preferences) clearOptionalPreferenceStorage();
    setConsent(saved); setDraft(normalized); setOpen(false); setCustomize(false);
    try {
      if (authenticatedUserIdRef.current) await api("/api/privacy/consent", { method: "PUT", body: JSON.stringify({ ...normalized, noticeVersion: PRIVACY_CONSENT_NOTICE_VERSION, source: hostSource() }) });
    } catch {} finally { setSaving(false); }
  }

  if (!open) return null;
  return <div className="privacy-consent-layer-v363" role="presentation"><section className="privacy-consent-card-v363" role="dialog" aria-modal="true" aria-labelledby="privacy-consent-title-v363">
    <header><div><span className="privacy-consent-eyebrow-v363">Privacy choices</span><h2 id="privacy-consent-title-v363">Choose optional browser features</h2></div>{consent.decided && <ClusterButton type="button" className="" onClick={() => setOpen(false)} variant="quiet" size="compact">Close</ClusterButton>}</header>
    <p>Cluster uses necessary storage for authentication, security, offline work, and recovery. Preferences, analytics, and external embeds are separate optional categories. Analytics stays off unless this server has a reviewed provider and you explicitly enable it.</p>
    {customize ? <div className="privacy-consent-options-v363">{categories.map((category) => {
      const checked = category.id === "necessary" ? true : category.id === "preferences" ? draft.preferences : category.id === "analytics" ? draft.analytics : category.id === "externalContent" ? draft.externalContent : false;
      const disabled = category.required || !category.available;
      return <label key={category.id} className={`privacy-consent-option-v363${disabled ? " locked" : ""}`}><span><strong>{category.label}</strong><small>{category.description}</small>{!category.available && <em>Not currently used</em>}</span><ClusterInput type="checkbox" checked={checked} disabled={disabled} onChange={(event) => { if (category.id === "preferences") setDraft((c) => ({ ...c, preferences: event.target.checked })); if (category.id === "analytics") setDraft((c) => ({ ...c, analytics: event.target.checked })); if (category.id === "externalContent") setDraft((c) => ({ ...c, externalContent: event.target.checked })); }} /></label>;
    })}</div> : null}
    {customize && config?.analyticsProviders?.length ? <div className="settings-inline-note-v272"><strong>Analytics provider</strong><span>{config.analyticsProviders.map((provider) => `${provider.name}: ${provider.purpose} Retention: ${provider.retentionDays} days.`).join(" ")}</span></div> : null}
    <footer><a href="/legal/privacy">Privacy notice</a><div>
      {!customize && <ClusterButton type="button" onClick={() => setCustomize(true)} variant="secondary">Customize</ClusterButton>}
      <ClusterButton type="button" disabled={saving} onClick={() => void save({ preferences: false, analytics: false, externalContent: false })} variant="secondary">Reject optional</ClusterButton>
      {customize ? <ClusterButton type="button" className="" disabled={saving} onClick={() => void save(draft)} variant="primary">Save choices</ClusterButton> : <ClusterButton type="button" className="" disabled={saving} onClick={() => void save({ preferences: true, analytics: analyticsAvailable, externalContent: true })} variant="primary">Accept optional</ClusterButton>}
    </div></footer>
  </section></div>;
}
