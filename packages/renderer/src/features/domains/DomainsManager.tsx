import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "../../core/api";
import { copyClusterText } from "../../core/clipboard";
import { openClusterWorkNavigation } from "../workflow/work-navigation";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import "./domains-manager.css";

type Domain = {
  id: string; domain: string; note: string | null; revision: number;
  registrar: string | null; expiresOn: string | null;
  verificationState: string; verifiedAt: string | null;
  bindingHostname: string | null; bindingServerLabel: string | null;
};
type Challenge = { host: string; type: "TXT"; value: string };

const DAY = 86_400_000;
export function daysUntil(date?: string | null) {
  if (!date) return null;
  return Math.round((new Date(date).getTime() - Date.now()) / DAY);
}
export function renewalTone(days: number | null) {
  return days === null ? undefined : days < 0 ? "danger" : days <= 30 ? "warning" : undefined;
}
export function renewalLabel(days: number | null) {
  if (days === null) return "No renewal date";
  if (days < 0) return `Expired ${-days}d ago`;
  if (days === 0) return "Renews today";
  return days > 60 ? `Renews in ${Math.round(days / 30)} mo` : `Renews in ${days}d`;
}

/** Studio domains: what you own, when it renews, and DNS proof of ownership.
 * Pointing a hostname at this server lives in Server settings → Domains. */
export function DomainsManager() {
  const [domains, setDomains] = useState<Domain[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [adding, setAdding] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const all: Domain[] = [];
      let after = "";
      do {
        const page = await api<{ domains: Domain[]; nextCursor: string | null }>(`/api/admin/domains${after ? `?after=${encodeURIComponent(after)}` : ""}`);
        all.push(...page.domains);
        after = page.nextCursor || "";
      } while (after && all.length < 500);
      setDomains(all); setError("");
    } catch (reason) { setDomains([]); setError(formatApiError(reason)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    const domain = adding.trim();
    if (!domain) return;
    setBusy(true);
    try {
      const result = await api<{ domain: Domain }>("/api/admin/domains", { method: "POST", body: JSON.stringify({ domain }) });
      setAdding(""); await load(); setSelectedId(result.domain.id);
    } catch (reason) { setError(formatApiError(reason)); } finally { setBusy(false); }
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (domains || []).filter((domain) => !needle || domain.domain.includes(needle) || (domain.registrar || "").toLowerCase().includes(needle))
      .sort((a, b) => (daysUntil(a.expiresOn) ?? 1e9) - (daysUntil(b.expiresOn) ?? 1e9) || a.domain.localeCompare(b.domain));
  }, [domains, query]);
  const selected = (domains || []).find((domain) => domain.id === selectedId) || null;

  return <section className="dm" data-open={selected ? "true" : undefined}>
    <div className="dm__list">
      <header className="dm__head">
        <ClusterTextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search domains" aria-label="Search domains" />
        <form className="dm__add" onSubmit={(event) => { event.preventDefault(); void add(); }}>
          <ClusterTextInput value={adding} disabled={busy} onChange={(event) => setAdding(event.target.value)} placeholder="example.com" aria-label="Add a domain" />
          <ClusterButton type="submit" size="compact" variant="primary" disabled={busy || !adding.trim()}>Add</ClusterButton>
        </form>
      </header>
      {error ? <p className="dm__error" role="alert">{error}</p> : null}
      {domains === null ? <p className="pv-empty">Loading…</p> : shown.length ? <ul className="dm__rows">{shown.map((domain) => {
        const days = daysUntil(domain.expiresOn);
        const verified = domain.verificationState === "verified";
        return <li key={domain.id}>
          <button type="button" aria-current={domain.id === selectedId || undefined} onClick={() => setSelectedId(domain.id)}>
            <span className="dm__mark" data-verified={verified || undefined}><ClusterIcon name={verified ? "check" : "globe"} /></span>
            <span className="dm__copy"><strong>{domain.domain}</strong><small>{[domain.registrar, domain.bindingHostname ? `→ ${domain.bindingHostname}` : ""].filter(Boolean).join(" · ") || (verified ? "Verified" : "Not verified")}</small></span>
            <span className="dm__renew" data-tone={renewalTone(days)}>{renewalLabel(days)}</span>
          </button>
        </li>;
      })}</ul> : <div className="dm__empty"><ClusterIcon name="globe" /><p>{query ? "No matches." : "Add the domains your studio owns to track renewals and prove ownership."}</p></div>}
    </div>
    {selected ? <DomainDetail key={selected.id} domain={selected} onClose={() => setSelectedId("")} onChanged={load} /> : null}
  </section>;
}

function DomainDetail({ domain, onClose, onChanged }: { domain: Domain; onClose: () => void; onChanged: () => Promise<void> }) {
  const [registrar, setRegistrar] = useState(domain.registrar || "");
  const [expiresOn, setExpiresOn] = useState(domain.expiresOn?.slice(0, 10) || "");
  const [note, setNote] = useState(domain.note || "");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = registrar !== (domain.registrar || "") || expiresOn !== (domain.expiresOn?.slice(0, 10) || "") || note !== (domain.note || "");
  const verified = domain.verificationState === "verified";
  const days = daysUntil(domain.expiresOn);

  useEffect(() => {
    if (verified) return;
    void api<{ dnsChallenge: Challenge }>(`/api/admin/domains/${encodeURIComponent(domain.id)}/challenge`).then((result) => setChallenge(result.dnsChallenge)).catch(() => undefined);
  }, [domain.id, verified]);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true); setStatus("");
    try { await action(); await onChanged(); setStatus(label); } catch (reason) { setStatus(formatApiError(reason)); } finally { setBusy(false); }
  }

  return <article className="dm__detail" aria-label={domain.domain}>
    <header className="dm__detail-head">
      <ClusterIconButton size="compact" className="dm__back" label="All domains" onClick={onClose}><ClusterIcon name="chevron-left" /></ClusterIconButton>
      <div><h3>{domain.domain}</h3><small data-tone={renewalTone(days)}>{renewalLabel(days)}</small></div>
      <a className="dm__visit" href={`https://${domain.domain}`} target="_blank" rel="noreferrer" aria-label={`Open ${domain.domain}`}><ClusterIcon name="globe" /></a>
    </header>
    {status ? <p className="dm__status" role="status">{status}</p> : null}

    <h4>Renewal</h4>
    <div className="dm__group">
      <label className="dm__row"><span>Registrar</span><ClusterTextInput value={registrar} onChange={(event) => setRegistrar(event.target.value)} placeholder="Cloudflare, Namecheap…" /></label>
      <label className="dm__row"><span>Renews on</span><input className="dm__date" type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></label>
      <label className="dm__row"><span>Notes</span><ClusterTextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="Who pays, auto-renew…" /></label>
      {dirty ? <div className="dm__actions"><ClusterButton size="compact" variant="quiet" onClick={() => { setRegistrar(domain.registrar || ""); setExpiresOn(domain.expiresOn?.slice(0, 10) || ""); setNote(domain.note || ""); }}>Revert</ClusterButton>
        <ClusterButton size="compact" variant="primary" disabled={busy} onClick={() => void run("Saved.", () => api(`/api/admin/domains/${encodeURIComponent(domain.id)}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: domain.revision, registrar: registrar.trim() || null, expiresOn: expiresOn || null, note: note.trim() || null }) }))}>Save</ClusterButton></div> : null}
    </div>

    <h4>Ownership</h4>
    <div className="dm__group">
      {verified ? <p className="dm__ok"><ClusterIcon name="check" />Verified{domain.verifiedAt ? ` ${new Date(domain.verifiedAt).toLocaleDateString()}` : ""}</p> : <>
        <p className="dm__hint">Add this TXT record at your DNS provider, then verify.</p>
        {challenge ? <>
          <div className="dm__record"><span>Host</span><code>{challenge.host}</code><ClusterIconButton size="compact" label="Copy host" onClick={() => copyClusterText(challenge.host)}><ClusterIcon name="file" /></ClusterIconButton></div>
          <div className="dm__record"><span>Value</span><code>{challenge.value}</code><ClusterIconButton size="compact" label="Copy value" onClick={() => copyClusterText(challenge.value)}><ClusterIcon name="file" /></ClusterIconButton></div>
        </> : null}
        <div className="dm__actions"><ClusterButton size="compact" variant="primary" disabled={busy} onClick={() => void run("Ownership verified.", () => api(`/api/admin/domains/${encodeURIComponent(domain.id)}/verify`, { method: "POST", body: JSON.stringify({ expectedRevision: domain.revision }) }))}>Verify</ClusterButton></div>
      </>}
    </div>

    <h4>Server address</h4>
    <div className="dm__group">
      <p className="dm__hint">{domain.bindingHostname ? <>Members reach Cluster at <strong>{domain.bindingHostname}</strong>{domain.bindingServerLabel ? ` on ${domain.bindingServerLabel}` : ""}.</> : verified ? "Not pointed at a server yet." : "Verify ownership first."}</p>
      <div className="dm__actions"><ClusterButton size="compact" variant="secondary" disabled={!verified} onClick={() => { window.sessionStorage.setItem("cluster-server-config-section", "domains"); openClusterWorkNavigation({ screen: "serverConfig" }); }}>{domain.bindingHostname ? "Manage in Server settings" : "Set up in Server settings"}</ClusterButton></div>
    </div>

    <div className="dm__footer">
      {verified ? <ClusterButton size="compact" variant="quiet" disabled={busy} onClick={async () => {
        if (!await confirmCluster({ title: "Reset ownership proof?", message: "This issues a new TXT record and removes the server address. Update DNS afterwards.", confirmLabel: "Reset", tone: "danger" })) return;
        await run("New TXT record issued.", () => api(`/api/admin/domains/${encodeURIComponent(domain.id)}/rotate-challenge`, { method: "POST", body: JSON.stringify({ expectedRevision: domain.revision }) }));
      }}>Reset proof</ClusterButton> : null}
      <ClusterButton size="compact" variant="quiet" className="dm__remove" disabled={busy || Boolean(domain.bindingHostname)} title={domain.bindingHostname ? "Remove its server address first" : undefined} onClick={async () => {
        if (!await confirmCluster({ title: `Remove ${domain.domain}?`, message: "It leaves the studio registry. Your DNS and registrar are not changed.", confirmLabel: "Remove", tone: "danger" })) return;
        setBusy(true);
        try { await api(`/api/admin/domains/${encodeURIComponent(domain.id)}`, { method: "DELETE" }); onClose(); await onChanged(); } catch (reason) { setStatus(formatApiError(reason)); } finally { setBusy(false); }
      }}>Remove domain</ClusterButton>
    </div>
  </article>;
}
