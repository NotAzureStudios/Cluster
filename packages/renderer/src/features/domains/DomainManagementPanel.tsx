import { useEffect, useState } from "react";
import { api, formatApiError } from "../../core/api";
import { copyClusterText } from "../../core/clipboard";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput } from "../../components/ClusterNativeControls";

type Domain = {
  id: string; domain: string; note: string | null; revision: number;
  registrar: string | null; expiresOn: string | null;
  verificationState: string; verifiedAt: string | null;
  bindingHostname: string | null; bindingServerLabel: string | null;
  bindingServerInstanceId: string | null;
  bindingDnsType: "A" | "AAAA" | "CNAME" | null;
  bindingDnsTarget: string | null; bindingNote: string | null;
};
type ConnectionMode = "lan" | "private_vpn" | "reverse_proxy" | "direct_https" | "managed_tunnel";
type ConnectionProvider = "manual" | "tailscale" | "wireguard" | "caddy" | "nginx" | "cloudflare" | "custom";
type ConnectionProfile = { mode: ConnectionMode; provider: ConnectionProvider; webPort: number; apiPort: number; publicPort: number };
type ConnectionPlan = { canonicalUrl: string; deploymentState: string; origin: { web: string; api: string }; instructions: string[]; artifacts: { filename: string; contents: string; purpose: string }[] };
type ConnectionStatus = { checkedAt: string; local: { web: string; api: string }; publicDns: string; publicHttps: string; outsideReachability: string; desktopLogin: string };
const connectionProviders: Record<ConnectionMode, ConnectionProvider[]> = {
  lan: ["manual", "caddy", "nginx"], private_vpn: ["tailscale", "wireguard", "custom"], reverse_proxy: ["caddy", "nginx", "custom"], direct_https: ["caddy", "nginx"], managed_tunnel: ["cloudflare", "custom"],
};
type Challenge = { host: string; type: "TXT"; value: string };
type DnsStatus = { checkedAt: string; ownership: "present" | "missing" | "unavailable"; routing: "matching" | "mismatch" | "unavailable" | "not_configured"; tls: "not_checked"; connectivity: "not_checked"; serverIdentityRecorded: boolean };

/** Accept the common paste of an HTTPS origin, but never silently discard
 * paths, credentials, ports or query fragments. The server remains authoritative. */
export function bindingHostnameFromDraft(value: string): string {
  const raw = value.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (!url.username && !url.password && !url.port && url.pathname === "/" && !url.search && !url.hash)
        return url.hostname.toLowerCase().replace(/\.$/, "");
    } catch { /* Leave invalid input visible for correction. */ }
  }
  return raw.toLowerCase().replace(/\.$/, "");
}

/** Studio owns registration and proof. Server Configuration owns routing.
 * Vault is only an inventory reference and contains no domain mutations. */
export function StudioDomainsPanel() { return <DomainsAdministrationPanel surface="studio" />; }
export function ServerDomainsPanel() { return <DomainsAdministrationPanel surface="server" />; }
function DomainsAdministrationPanel({ surface }: { surface: "studio" | "server" }) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<Domain | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<(Challenge & { domainId: string }) | null>(null);
  const [dnsStatus, setDnsStatus] = useState<DnsStatus | null>(null);
  const [hostname, setHostname] = useState("");
  const [dnsType, setDnsType] = useState<"A" | "AAAA" | "CNAME">("CNAME");
  const [dnsTarget, setDnsTarget] = useState("");
  const [registrar, setRegistrar] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [domainNote, setDomainNote] = useState("");
  const [connection, setConnection] = useState<ConnectionProfile>({ mode: "managed_tunnel", provider: "cloudflare", webPort: 3000, apiPort: 4000, publicPort: 443 });
  const [connectionPlan, setConnectionPlan] = useState<ConnectionPlan | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [readiness, setReadiness] = useState<{ configured: boolean; checks: { id: string; label: string; pass: boolean; expected: unknown; observed: unknown }[]; gatewayInstalled: string } | null>(null);
  const [publicStatus, setPublicStatus] = useState<{checkedAt: string; dns: string; tls: string; http: string; status?: number; note?: string} | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [connectionBound, setConnectionBound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = domains.find(row => row.id === selectedId) || (selectedRecord?.id === selectedId ? selectedRecord : null);

  async function refreshPage(after = cursor, searchTerm = search) {
    const query = new URLSearchParams();
    if (after) query.set("after", after);
    if (searchTerm.trim()) query.set("search", searchTerm.trim());
    const result = await api<{ domains: Domain[]; nextCursor: string | null }>(`/api/admin/domains?${query.toString()}`);
    setDomains(result.domains || []);
    setNextCursor(result.nextCursor || null);
    setSelectedId(old => old || result.domains[0]?.id || "");
    setSelectedRecord(old => result.domains.find(row => row.id === old?.id) || old);
  }
  useEffect(() => { void refreshPage().catch(err => setError(formatApiError(err))); }, [cursor, search]);
  // An OOBE proposal is not an active network route. Load it once for the
  // authenticated owner, and never overwrite existing verified domain data.
  useEffect(() => {
    let active = true;
    void api<{ intent: { domain: string; mode: ConnectionMode; provider: ConnectionProvider } | null }>("/api/admin/domains/setup-intent")
      .then(({ intent }) => { if (!active || !intent) return;
        if (surface === "studio") setNewDomain(current => current || intent.domain);
        if (surface === "server") setConnection(current => ({ ...current, mode: intent.mode, provider: intent.provider, publicPort: intent.mode === "lan" ? 80 : 443 }));
      }).catch(() => undefined);
    return () => { active = false; };
  }, [surface]);
  useEffect(() => {
    if (!selectedId || domains.some(row => row.id === selectedId)) return;
    let cancelled = false;
    void api<{ domain: Domain }>(`/api/admin/domains/${encodeURIComponent(selectedId)}`)
      .then(result => { if (!cancelled) setSelectedRecord(result.domain); })
      .catch(err => { if (!cancelled) setError(formatApiError(err)); });
    return () => { cancelled = true; };
  }, [selectedId, domains]);
  useEffect(() => {
    setDnsStatus(null);
    setHostname(selected?.bindingHostname || (selected ? `cluster.${selected.domain}` : ""));
    setDnsType(selected?.bindingDnsType || "CNAME");
    setDnsTarget(selected?.bindingDnsTarget || "");
    setRegistrar(selected?.registrar || "");
    setExpiresOn(selected?.expiresOn?.slice(0, 10) || "");
    setDomainNote(selected?.note || "");
  }, [selectedId, selected?.revision]);
  useEffect(() => {
    if (!selectedId) { setConnectionPlan(null); setConnectionStatus(null); return; }
    let cancelled = false;
    setConnectionLoading(true); setConnectionStatus(null); setPublicStatus(null); setConnectionError("");
    void api<{ profile: ConnectionProfile | null; plan: ConnectionPlan | null; boundToThisServer: boolean }>(`/api/admin/domains/${encodeURIComponent(selectedId)}/connection`)
      .then(result => { if (!cancelled) {
        if (result.profile) setConnection(result.profile);
        setConnectionPlan(result.plan); setConnectionBound(result.boundToThisServer);
      } })
      .catch(err => { if (!cancelled) setConnectionError(formatApiError(err)); })
      .finally(() => { if (!cancelled) setConnectionLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, selected?.revision]);
  function setConnectionMode(mode: ConnectionMode) {
    const provider = connectionProviders[mode][0];
    setConnection(previous => ({ ...previous, mode, provider, publicPort: mode === "lan" && provider === "manual" ? 80 : 443 }));
  }
  async function mutate(action: () => Promise<{ domain?: Domain } | void>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await action();
      if (result?.domain) setSelectedRecord(result.domain);
      await refreshPage();
    } catch (err) { setError(formatApiError(err)); }
    finally { setBusy(false); }
  }
  const expiresMs = selected?.expiresOn ? new Date(selected.expiresOn).getTime() : null;
  const daysUntilExpiry = expiresMs !== null && Number.isFinite(expiresMs) ? Math.ceil((expiresMs - Date.now()) / 86400000) : null;

  return <section className="cluster-panel cluster-domains-rc46" aria-label={surface === "studio" ? "Studio domain registry" : "Server domain connectivity"}>
    <header><h2>{surface === "studio" ? "Studio domains" : "Server domains & access"}</h2><p>{surface === "studio" ? "Manage ownership and renewals." : "Verify a domain, connect a gateway, and test access."}</p></header>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {surface === "studio" && <div className="cluster-form-row">
      <label>Register domain <ClusterInput value={newDomain} onChange={event => setNewDomain(event.target.value)} placeholder="example.com" /></label>
      <ClusterButton disabled={busy || !newDomain.trim()} onClick={() => void mutate(async () => {
        const result = await api<{ domain: Domain; dnsChallenge: Challenge }>("/api/admin/domains", { method: "POST", body: JSON.stringify({ domain: newDomain }) });
        setNewDomain(""); setSelectedId(result.domain.id); setSelectedRecord(result.domain); setChallenge({ ...result.dnsChallenge, domainId: result.domain.id });
        setNotice("Domain registered. Publish its TXT challenge before verifying ownership.");
        return result;
      })}>Register</ClusterButton>
    </div>}
    <div className="cluster-form-row">
      <label>Find domains <ClusterInput value={search} onChange={event => { setSearch(event.target.value); setCursor(""); setCursorHistory([]); }} placeholder="Search registered domains" /></label>
      <label>Managed domains
        <select value={selectedId} onChange={event => setSelectedId(event.target.value)}>
          <option value="">Select domain</option>
          {selected && !domains.some(row => row.id === selected.id) && <option value={selected.id}>{selected.domain} · selected</option>}
          {domains.map(row => <option key={row.id} value={row.id}>{row.domain} · {row.verificationState}</option>)}
        </select>
      </label>
      <ClusterButton disabled={!cursorHistory.length || busy} onClick={() => { setCursor(cursorHistory.at(-1) || ""); setCursorHistory(previous => previous.slice(0, -1)); }}>Previous 50</ClusterButton>
      <ClusterButton disabled={!nextCursor || busy} onClick={() => { setCursorHistory(previous => [...previous, cursor]); setCursor(nextCursor || ""); }}>Next 50</ClusterButton>
    </div>
    {selected && <div className="cluster-panel">
      <h3>{selected.domain}</h3>
      <p>Ownership: <strong>{selected.verificationState}</strong> {selected.verifiedAt ? `· verified ${new Date(selected.verifiedAt).toLocaleDateString()}` : ""}</p>
      {surface === "studio" && <><details className="cluster-domain-help-rc46"><summary>About renewal records</summary><p>Registrar and renewal information is entered by administrators and is not automatically checked against your registrar.</p></details>
      {daysUntilExpiry !== null && <p role={daysUntilExpiry <= 30 ? "alert" : undefined}>{daysUntilExpiry < 0 ? `Reported domain expiry passed ${-daysUntilExpiry} day(s) ago.` : `Reported renewal date is in ${daysUntilExpiry} day(s).`}</p>}
      <label>Registrar <ClusterInput value={registrar} onChange={event => setRegistrar(event.target.value)} placeholder="Optional registrar name" /></label>
      <label>Reported expiration date <input type="date" value={expiresOn} onChange={event => setExpiresOn(event.target.value)} /></label>
      <label>Notes <ClusterInput value={domainNote} onChange={event => setDomainNote(event.target.value)} placeholder="Internal ownership and renewal notes" /></label>
      <ClusterButton disabled={busy} onClick={() => void mutate(async () => {
        const response = await api<{ domain: Domain }>(`/api/admin/domains/${encodeURIComponent(selected.id)}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: selected.revision, registrar: registrar.trim() || null, expiresOn: expiresOn || null, note: domainNote.trim() || null }) });
        setNotice("Domain management details updated."); return response;
      })}>Save domain details</ClusterButton>
      <div className="cluster-panel">
        <h3>Prove DNS ownership</h3>
        <ClusterButton disabled={busy} onClick={() => void mutate(async () => {
          const response = await api<{ dnsChallenge: Challenge }>(`/api/admin/domains/${encodeURIComponent(selected.id)}/challenge`);
          setChallenge({ ...response.dnsChallenge, domainId: selected.id });
        })}>Show TXT challenge</ClusterButton>
        {challenge?.domainId === selected.id && <div className="cluster-panel">
          <p>Publish this DNS TXT record before verifying:</p>
          <p>Host: <code>{challenge.host}</code></p>
          <p>Value: <code>{challenge.value}</code></p>
          <ClusterButton onClick={() => copyClusterText(challenge.host)}>Copy TXT host</ClusterButton>
          <ClusterButton onClick={() => copyClusterText(challenge.value)}>Copy TXT value</ClusterButton>
        </div>}
        <ClusterButton disabled={busy} onClick={() => void mutate(async () => {
          const response = await api<{ domain: Domain }>(`/api/admin/domains/${encodeURIComponent(selected.id)}/verify`, { method: "POST", body: JSON.stringify({ expectedRevision: selected.revision }) });
          setNotice("DNS ownership verified."); return response;
        })}>Verify ownership</ClusterButton>
        <ClusterButton disabled={busy} onClick={() => {
          if (!window.confirm("Rotate the DNS ownership challenge? This revokes the current proof and removes the server binding. DNS and TLS records are NOT removed automatically.")) return;
          void mutate(async () => {
            const response = await api<{ domain: Domain; dnsChallenge: Challenge }>(`/api/admin/domains/${encodeURIComponent(selected.id)}/rotate-challenge`, { method: "POST", body: JSON.stringify({ expectedRevision: selected.revision }) });
            setChallenge({ ...response.dnsChallenge, domainId: selected.id }); setDnsStatus(null); setNotice("Previous proof and binding revoked. Publish the new TXT challenge."); return response;
          });
        }}>Rotate ownership proof</ClusterButton>
      </div></>}
      {surface === "server" && <><div className="cluster-panel">
        <h3>Attach to this Cluster server</h3>
        <p>Server: <strong>{selected.bindingServerLabel || "This Cluster installation"}</strong></p>
        <p>{selected.bindingServerInstanceId ? <>Installation ID: <code>{selected.bindingServerInstanceId}</code></> : "No verified server binding yet."}</p>
        <details className="cluster-domain-help-rc46"><summary>How server binding works</summary><p>Only this server's installation ID can be bound. Other Cluster servers require their own identity handshake.</p></details>
        <label>Hostname <ClusterInput value={hostname} onChange={event => setHostname(event.target.value)} onBlur={() => setHostname(bindingHostnameFromDraft(hostname))} placeholder={`cluster.${selected.domain}`} /></label>
        <p className="muted tight">Enter the hostname only, without <code>https://</code>. A pasted plain HTTPS origin is reduced to its hostname on blur. Do not enter localhost or a path.</p>
        {/^[a-z]+:\/\//i.test(hostname) || /[/?#]/.test(hostname) ? <p role="alert">Use only a DNS hostname such as <code>cluster.{selected.domain}</code>.</p> : null}
        <label>DNS record type <select value={dnsType} onChange={event => { setDnsType(event.target.value as "A" | "AAAA" | "CNAME"); setDnsTarget(""); }}>
          <option value="CNAME">CNAME</option><option value="A">A (IPv4)</option><option value="AAAA">AAAA (IPv6)</option>
        </select></label>
        <label>DNS target <ClusterInput value={dnsTarget} onChange={event => setDnsTarget(event.target.value)} placeholder={dnsType === "CNAME" ? "your-tunnel-id.cfargotunnel.com" : dnsType === "A" ? "203.0.113.10" : "2001:db8::10"} /></label>
        {dnsType === "CNAME" && <p className="muted tight">For Cloudflare Tunnel use the actual CNAME target Cloudflare assigned to this tunnel, not your public URL or this example. Tunnel routing and TLS are configured separately.</p>}
        <p>Required manual record: <code>{hostname || "hostname"} {dnsType} {dnsTarget || "target"}</code></p>
        <ClusterButton disabled={!hostname.trim() || !dnsTarget.trim()} onClick={() => copyClusterText(`${hostname} ${dnsType} ${dnsTarget}`)}>Copy DNS instruction</ClusterButton>
        <ClusterButton disabled={busy || selected.verificationState !== "verified" || !hostname.trim() || !dnsTarget.trim()} onClick={() => void mutate(async () => {
          const response = await api<{ domain: Domain }>(`/api/admin/domains/${encodeURIComponent(selected.id)}/bind`, { method: "POST", body: JSON.stringify({ expectedRevision: selected.revision, hostname: bindingHostnameFromDraft(hostname), dnsType, dnsTarget }) });
          setNotice("Hostname attached to this Cluster installation. Publish DNS and configure TLS separately."); return response;
        })}>Save verified binding</ClusterButton>
        {selected.bindingHostname && <ClusterButton disabled={busy} onClick={() => void mutate(async () => {
          const response = await api<{ domain: Domain }>(`/api/admin/domains/${encodeURIComponent(selected.id)}/unbind`, { method: "POST", body: JSON.stringify({ expectedRevision: selected.revision }) });
          setNotice("Binding removed. Existing DNS and TLS records require manual cleanup."); return response;
        })}>Remove binding</ClusterButton>}
        <ClusterButton disabled={busy} onClick={() => void mutate(async () => {
          const response = await api<DnsStatus>(`/api/admin/domains/${encodeURIComponent(selected.id)}/dns-status`);
          setDnsStatus(response); setNotice("Read-only DNS check completed.");
        })}>Check DNS status</ClusterButton>
        {dnsStatus && <div className="cluster-panel" role="status">
          <p>Checked {new Date(dnsStatus.checkedAt).toLocaleString()}</p>
          <p>TXT ownership: <strong>{dnsStatus.ownership}</strong> · Intended DNS routing: <strong>{dnsStatus.routing}</strong></p>
          <p>TLS: not checked · Cluster reachability: not checked. Matching DNS does not mean this hostname is publicly accessible or secure.</p>
        </div>}
      </div>
      <div className="cluster-panel" aria-label="Domain connectivity and deployment">
        <h3>Connect people to this server</h3>
        <p>Configure how members reach both the web frontend and API through one canonical address. Select a mode, save it, deploy its gateway configuration, then test from a separate device.</p>
        {!connectionBound && <p role="alert">First verify the domain and bind its hostname to this installation. A saved DNS binding alone does not expose the server.</p>}
        {connectionError && <p role="alert">{connectionError}</p>}
        {connectionLoading && <p role="status">Loading network deployment profile…</p>}
        <div className="cluster-form-row">
          <label>Connection mode
            <select value={connection.mode} onChange={event => setConnectionMode(event.target.value as ConnectionMode)}>
              <option value="lan">Private LAN</option>
              <option value="private_vpn">Private VPN / Tailscale</option>
              <option value="reverse_proxy">Self-hosted reverse proxy</option>
              <option value="direct_https">Direct public HTTPS</option>
              <option value="managed_tunnel">Managed secure tunnel</option>
            </select>
          </label>
          <label>Gateway / network provider
            <select value={connection.provider} onChange={event => setConnection(old => ({ ...old, provider: event.target.value as ConnectionProvider, publicPort: old.mode === "lan" && event.target.value === "manual" ? 80 : 443 }))}>
              {connectionProviders[connection.mode].map(provider => <option key={provider} value={provider}>{provider}</option>)}
            </select>
          </label>
          <label>Web origin port <input type="number" min="1" max="65535" value={connection.webPort} onChange={event => setConnection(old => ({ ...old, webPort: Number(event.target.value) }))} /></label>
          <label>API origin port <input type="number" min="1" max="65535" value={connection.apiPort} onChange={event => setConnection(old => ({ ...old, apiPort: Number(event.target.value) }))} /></label>
        </div>
        <p>Recommended: expose only the selected gateway, not the application, database or NAS ports. Reverse-proxy and direct-internet modes require HTTPS on 443. LAN-only plaintext must never be exposed publicly.</p>
        <ClusterButton disabled={busy || !connectionBound || connectionLoading} onClick={() => void mutate(async () => {
          const response = await api<{ revision: number; profile: ConnectionProfile; plan: ConnectionPlan }>(`/api/admin/domains/${encodeURIComponent(selected.id)}/connection`, {
            method: "PUT", body: JSON.stringify({ expectedRevision: selected.revision, ...connection }),
          });
          setConnection(response.profile); setConnectionPlan(response.plan); setConnectionStatus(null); setPublicStatus(null);
          setNotice("Access plan saved. Deploy its gateway instructions and verify from a remote client before relying on this URL.");
          return { domain: { ...selected, revision: response.revision } };
        })}>Save access profile &amp; generate deployment</ClusterButton>
        {connectionPlan && <div className="cluster-panel">
          <p>Planned member address: <strong>{connectionPlan.canonicalUrl}</strong> <ClusterButton onClick={() => copyClusterText(connectionPlan.canonicalUrl)}>Copy</ClusterButton></p>
          <p>Origin routing: Web <code>{connectionPlan.origin.web}</code> · API <code>{connectionPlan.origin.api}</code></p>
          <p role="status">Deployment: operator action required. Configuration is not proof of live connectivity, TLS, or Desktop sign-in.</p>
          <ol>{connectionPlan.instructions.map((instruction, i) => <li key={i}>{instruction}</li>)}</ol>
          {connectionPlan.artifacts.map(artifact => <div className="cluster-panel" key={artifact.filename}>
            <strong>{artifact.filename}</strong> · {artifact.purpose}
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 300, overflow: "auto" }}>{artifact.contents}</pre>
            <ClusterButton onClick={() => copyClusterText(artifact.contents)}>Copy {artifact.filename}</ClusterButton>
          </div>)}
          <div className="cluster-panel" aria-label="Deployment package and readiness">
            <h4>Deployment review</h4>
            <p>The saved configuration can be packaged for an operator or gateway manager. Generating a package does not activate the route.</p>
            <ClusterButton disabled={busy} onClick={() => void mutate(async () => {
              const result = await api<{ bundle: object }>(`/api/admin/domains/${encodeURIComponent(selected.id)}/deployment/bundle`);
              const file = new Blob([JSON.stringify(result.bundle, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(file);
              const anchor = document.createElement("a"); anchor.href = url; anchor.download = `cluster-domain-${selected.domain}.json`;
              document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
              setNotice("Deployment bundle generated. Review and install gateway artifacts explicitly.");
            })}>Download deployment bundle</ClusterButton>
            <ClusterButton disabled={busy} onClick={() => void mutate(async () => {
              const result = await api<typeof readiness & { ok: true }>(`/api/admin/domains/${encodeURIComponent(selected.id)}/deployment/readiness`);
              setReadiness(result); setNotice("Compared server settings with the selected connection plan.");
            })}>Check server configuration</ClusterButton>
            {readiness && <div role="status"><p>{readiness.configured ? "Server settings match the plan." : "Server settings need review."} Gateway installed: not verified.</p>
              <ul>{readiness.checks.map(check => <li key={check.id}>{check.pass ? "✓" : "Needs change"}: {check.label} (expected {String(check.expected)}, observed {String(check.observed ?? "unset")})</li>)}</ul>
            </div>}
          </div>
          <ClusterButton disabled={busy} onClick={() => void mutate(async () => {
            const status = await api<ConnectionStatus>(`/api/admin/domains/${encodeURIComponent(selected.id)}/connection/check`);
            setConnectionStatus(status); setNotice("Local listener check completed. This does not test remote client reachability.");
          })}>Check local web and API listeners</ClusterButton>
          {connectionStatus && <p role="status">{new Date(connectionStatus.checkedAt).toLocaleString()} · Web: <strong>{connectionStatus.local.web}</strong> · API: <strong>{connectionStatus.local.api}</strong> · Public HTTPS, remote access, and Desktop login: not checked.</p>}
          {connection.mode !== "lan" && connection.mode !== "private_vpn" && <ClusterButton disabled={busy} onClick={() => void mutate(async () => {
            const status = await api<{checkedAt: string; dns: string; tls: string; http: string; status?: number; note?: string}>(`/api/admin/domains/${encodeURIComponent(selected.id)}/connection/check-public`);
            setPublicStatus(status); setNotice("Server-side public HTTPS check finished. Verify from a different network too.");
          })}>Check public DNS, TLS &amp; HTTP</ClusterButton>}
          {publicStatus && <p role="status">{new Date(publicStatus.checkedAt).toLocaleString()} · Public DNS: <strong>{publicStatus.dns}</strong> · TLS certificate: <strong>{publicStatus.tls}</strong> · HTTP: <strong>{publicStatus.http}</strong>{publicStatus.status ? ` (${publicStatus.status})` : ""}. This is a server-side observation, not remote-client certification.</p>}
        </div>}
      </div></>}
    </div>}
  </section>;
}

/** Vault is an inventory view only; domain secrets and live network controls
 * are handled by Studio and Server Configuration respectively. */
export function DomainInventoryPanel() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<{ domains: Domain[] }>("/api/admin/domains")
      .then(result => { if (active) setDomains(result.domains || []); })
      .catch(reason => { if (active) setError(formatApiError(reason)); });
    return () => { active = false; };
  }, []);
  return <section className="cluster-panel" aria-label="Domain inventory">
    <h2>Domain inventory</h2>
    <p>Reference only. Register domains in Studio Settings and configure server connections in Server Configuration.</p>
    {error && <p role="alert">{error}</p>}
    {domains.map(domain => <p key={domain.id}><strong>{domain.domain}</strong> · {domain.verificationState} · {domain.bindingHostname || "Not bound"}</p>)}
    {!domains.length && !error && <p>No domains on this page. Use Studio Settings to manage the full registry.</p>}
  </section>;
}
