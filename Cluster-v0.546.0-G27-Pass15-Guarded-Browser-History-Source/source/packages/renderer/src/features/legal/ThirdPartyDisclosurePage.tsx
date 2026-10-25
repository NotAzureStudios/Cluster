import { useEffect, useState } from "react";
import { api } from "../../core/api";
import "./privacy-policy.css";
import "./third-party-disclosure.css";
import { PolicyLoadingState } from "../../components/LoadingState";
import { ClusterLinkButton } from "../../components/ClusterButton";

type PublicProvider = {
  id: string;
  name: string;
  category: string;
  purpose: string;
  dataCategories: string[];
  recipientRole: string;
  feature?: string | null;
  consentCategory?: string | null;
  privacyUrl?: string | null;
  termsUrl?: string | null;
  regions: string[];
  retentionNote?: string | null;
  transferNote?: string | null;
  required: boolean;
  reviewedAt?: string | null;
};

type Payload = { ok: true; generatedAt: string; notice: string; providers: PublicProvider[] };

function label(value: string) {
  return value.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());
}

export default function ThirdPartyDisclosurePage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<Payload>("/api/public/privacy/third-parties").then(setPayload).catch((reason) => setError(reason instanceof Error ? reason.message : "Third-party disclosure could not be loaded.")); }, []);

  if (!payload && !error) return <PolicyLoadingState label="Loading third-party disclosure" />;

  return <main className="privacy-policy-shell-v362">
    <div className="privacy-policy-frame-v362 third-party-public-v377">
      <header className="privacy-policy-header-v362">
        <div><p className="eyebrow">Privacy</p><h1>Third-party data disclosure</h1><p>Operator-reviewed services that may receive information from this Cluster deployment.</p></div>
        <ClusterLinkButton className="" href="/legal/privacy" variant="secondary">Privacy Policy</ClusterLinkButton>
      </header>
      <section className="privacy-policy-card-v362 third-party-disclaimer-v377">
        <strong>Generated disclosure, not a legal classification.</strong>
        <p>{payload?.notice || "Cluster publishes only records that an administrator has reviewed and explicitly made public."}</p>
      </section>
      {error && <section className="privacy-policy-card-v362" role="alert"><strong>Disclosure unavailable</strong><p>{error}</p></section>}
      {payload && payload.providers.length === 0 && <section className="privacy-policy-card-v362"><h2>No public provider records</h2><p>This server has not published any operator-reviewed third-party provider records.</p></section>}
      {payload?.providers.map((provider) => <article className="privacy-policy-card-v362 third-party-provider-v377" key={provider.id}>
        <div className="third-party-provider-head-v377"><div><p className="eyebrow">{label(provider.category)}</p><h2>{provider.name}</h2></div><span>{label(provider.recipientRole)}</span></div>
        <p>{provider.purpose}</p>
        <dl className="third-party-public-grid-v377">
          <div><dt>Feature</dt><dd>{provider.feature || "Not specified"}</dd></div>
          <div><dt>Required for service</dt><dd>{provider.required ? "Yes" : "No"}</dd></div>
          <div><dt>Consent category</dt><dd>{provider.consentCategory ? label(provider.consentCategory) : "Not assigned"}</dd></div>
          <div><dt>Regions</dt><dd>{provider.regions.length ? provider.regions.join(", ") : "Not specified"}</dd></div>
        </dl>
        <div className="third-party-list-v377"><strong>Data categories</strong>{provider.dataCategories.length ? <ul>{provider.dataCategories.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Not specified.</p>}</div>
        {provider.retentionNote && <p><strong>Retention:</strong> {provider.retentionNote}</p>}
        {provider.transferNote && <p><strong>Transfer information:</strong> {provider.transferNote}</p>}
        {(provider.privacyUrl || provider.termsUrl) && <div className="third-party-links-v377">{provider.privacyUrl && <a href={provider.privacyUrl} target="_blank" rel="noreferrer">Provider privacy information</a>}{provider.termsUrl && <a href={provider.termsUrl} target="_blank" rel="noreferrer">Provider terms</a>}</div>}
      </article>)}
      <footer className="privacy-policy-footer-v362"><a href="/legal/privacy">Privacy Policy</a><a href="/legal/terms">Terms</a><a href="/legal/security">Security</a></footer>
    </div>
  </main>;
}
