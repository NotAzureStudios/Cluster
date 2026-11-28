import { useEffect, useState } from "react";
import { CLUSTER_ACCOUNT_TYPES, CLUSTER_ACCOUNT_TYPE_INFO, CLUSTER_CONTRACTOR_PORTAL_FEATURES, CLUSTER_CONTRACTOR_PORTAL_FEATURE_INFO, type ClusterExternalPortalSettings, type ClusterPortalAudience } from "@cluster/shared";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import "./portal-settings.css";

const SITES: Array<{ key: ClusterPortalAudience; label: string; description: string }> = [
  { key: "contractor", label: "Contractor portal", description: "A slim Cluster for contractors and guests, limited to the projects they're on." },
  { key: "client", label: "Client portal", description: "Clients send tickets and requests, follow them, and talk with the studio." },
  { key: "player", label: "Player portal", description: "No sign-in: applications, bug reports, help requests and ticket status." },
];

/** Server › External portal: which portals are on, where they live, and
 *  what contractors can use. */
export function PortalSettingsPanel() {
  const [settings, setSettings] = useState<ClusterExternalPortalSettings | null>(null);
  const [saved, setSaved] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<{ settings: ClusterExternalPortalSettings }>("/api/admin/portal").then((result) => { setSettings(result.settings); setSaved(JSON.stringify(result.settings)); }).catch((reason) => setStatus(reason instanceof Error ? reason.message : "Portal settings couldn't load.")); }, []);
  if (!settings) return <p className="psp__muted">{status || "Loading…"}</p>;
  const dirty = JSON.stringify(settings) !== saved;
  const patchSite = (key: ClusterPortalAudience, patch: Partial<{ enabled: boolean; host: string }>) => setSettings({ ...settings, [key]: { ...settings[key], ...patch } });
  async function save() {
    setBusy(true); setStatus("");
    try {
      const result = await api<{ settings: ClusterExternalPortalSettings }>("/api/admin/portal", { method: "PUT", body: JSON.stringify(settings) });
      setSettings(result.settings); setSaved(JSON.stringify(result.settings)); setStatus("Saved.");
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "Not saved."); }
    finally { setBusy(false); }
  }
  const hosts = SITES.map((site) => settings[site.key].enabled ? settings[site.key].host : "").filter(Boolean);
  const shared = hosts.length > 1 && new Set(hosts).size < hosts.length;
  return <div className="psp">
    <header className="psp__head">
      <div><h2>External portal</h2><p>Each portal can have its own address, or share one. A portal with no address is served from this server at <code>/portal</code>.</p></div>
      <ClusterButton variant="primary" busy={busy} disabled={!dirty} onClick={() => void save()}>Save</ClusterButton>
    </header>
    {status ? <p className="psp__muted" role="status">{status}</p> : null}
    {SITES.map((site) => <section key={site.key} className="psp__site" data-off={!settings[site.key].enabled || undefined}>
      <header>
        <label className="psp__toggle"><input type="checkbox" checked={settings[site.key].enabled} onChange={(event) => patchSite(site.key, { enabled: event.target.checked })} /><span><strong>{site.label}</strong><small>{site.description}</small></span></label>
      </header>
      {settings[site.key].enabled ? <div className="psp__body">
        <label className="psp__field"><span>Address</span><input value={settings[site.key].host} placeholder="portal.yourstudio.com" spellCheck={false} autoCapitalize="off" onChange={(event) => patchSite(site.key, { host: event.target.value.trim().toLowerCase() })} /></label>
        <p className="psp__muted">{settings[site.key].host ? <>Point <code>{settings[site.key].host}</code> at this server the same way as the main address (DNS plus your proxy or tunnel). Studio pages and APIs aren't reachable there.</> : <>Served at <code>/portal</code> on the main address.</>}</p>
        {site.key === "contractor" ? <fieldset className="psp__features"><legend>Contractors can use</legend>
          {CLUSTER_CONTRACTOR_PORTAL_FEATURES.map((feature) => <label key={feature}><input type="checkbox" checked={settings.contractor.features.includes(feature)} onChange={(event) => setSettings({ ...settings, contractor: { ...settings.contractor, features: event.target.checked ? CLUSTER_CONTRACTOR_PORTAL_FEATURES.filter((entry) => entry === feature || settings.contractor.features.includes(entry)) : settings.contractor.features.filter((entry) => entry !== feature) } })} />
            <span><strong>{CLUSTER_CONTRACTOR_PORTAL_FEATURE_INFO[feature].label}</strong><small>{CLUSTER_CONTRACTOR_PORTAL_FEATURE_INFO[feature].description}</small></span></label>)}
        </fieldset> : null}
      </div> : null}
    </section>)}
    {shared ? <p className="psp__muted">Portals sharing an address are told apart by who signs in: contractors and guests get the contractor portal, clients the client portal, and visitors who don't sign in the player portal.</p> : null}
    <section className="psp__types">
      <h3>Account types</h3>
      <dl>{CLUSTER_ACCOUNT_TYPES.map((type) => <div key={type}><dt>{CLUSTER_ACCOUNT_TYPE_INFO[type].label}</dt><dd>{CLUSTER_ACCOUNT_TYPE_INFO[type].description}{CLUSTER_ACCOUNT_TYPE_INFO[type].requiresExpiry ? " Needs an access end date." : ""}</dd></div>)}</dl>
    </section>
  </div>;
}
