import { useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterCopyButton } from "../../components/ClusterCopyButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { SettingsStateChip } from "../../components/SettingsStateChip";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import "./server-connection-guide.css";

type ConnectionMethod = "private" | "tunnel" | "lan";
const TARGETS = {
  private: { title: "Private studio (recommended)", provider: "Tailscale Serve", docs: "https://tailscale.com/docs/features/tailscale-serve", note: "Only invited tailnet members can reach this address. No home-router port forwarding is needed.",
    steps: ["Install Tailscale on the Cluster server and sign in.", "Invite studio members to the tailnet and restrict access with its ACLs.", "Enable HTTPS certificates for the tailnet, then run Tailscale Serve.", "Use the HTTPS address that Serve reports, then test from a member device."] },
  tunnel: { title: "Studio domain", provider: "Cloudflare Tunnel", docs: "https://developers.cloudflare.com/tunnel/get-started/", note: "Publish your chosen HTTPS hostname with Access policies. The Tunnel alone does not restrict who can reach the login page.",
    steps: ["Move the studio domain to Cloudflare or connect an existing Cloudflare-managed domain.", "Create a named Tunnel and install cloudflared on this Windows server.", "Add a published application route to http://localhost:3000, limited to your studio hostname.", "Add Cloudflare Access policies before sharing. Check authentication, browser Origin handling and session cookies."] },
  lan: { title: "Same network", provider: "Local network", docs: "", note: "For devices on the same trusted network only. Never forward the plain HTTP gateway through your router.",
    steps: ["Choose a fixed LAN address for this Windows server.", "Set up trusted TLS for the gateway and review its bind address in Server Config.", "Review the Windows Firewall rule for the gateway only.", "Restart the managed service and test HTTPS from a second local device."] },
} as const;
const isHttpsOrigin = (value: string): boolean => {
  try { const url = new URL(value); return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash; }
  catch { return false; }
};

/** Guide only: never alters listeners, router/firewall, proxy headers or DNS. */
export function ServerConnectionGuide({ onStageOrigin, onReview, busy }: {
  onStageOrigin: (origin: string) => void;
  onReview: () => void;
  busy?: boolean;
}) {
  const [method, setMethod] = useState<ConnectionMethod>("private");
  const [origin, setOrigin] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const target = TARGETS[method];
  const complete = target.steps.filter((_, i) => checked[`${method}:${i}`]).length;
  return <section className="panel cluster-connection-guide-rc46" aria-label="Guided studio network access">
    <header><div><span className="eyebrow">Connection assistant</span><h2>Let your team connect</h2><p>Choose how members reach Cluster. Your API and database stay private.</p></div><SettingsStateChip tone="info" icon="list">{complete}/{target.steps.length} checklist steps marked</SettingsStateChip></header>
    <div className="cluster-connection-methods-rc46" role="group" aria-label="Connection method">
      {(["private", "tunnel", "lan"] as const).map((choice) => <ClusterButton key={choice} unstyled type="button" className={method === choice ? "active" : ""} aria-pressed={method === choice} onClick={() => setMethod(choice)}><ClusterIcon name={choice === "private" ? "lock" : choice === "tunnel" ? "cloud" : "users"} /><span>{TARGETS[choice].title}</span></ClusterButton>)}
    </div>
    <div className="cluster-connection-guide-subhead-rc46"><strong>{target.provider}</strong><SettingsStateChip tone={method === "tunnel" ? "warning" : method === "private" ? "info" : "neutral"} icon={method === "tunnel" ? "warning" : method === "private" ? "lock" : "users"}>{method === "tunnel" ? "Requires Access policies" : method === "private" ? "Private member network" : "Trusted LAN only"}</SettingsStateChip><span>{target.note}</span></div>
    <ol className="cluster-connection-steps-rc46">{target.steps.map((step, i) => <li key={`${method}:${i}`}><label><input type="checkbox" checked={Boolean(checked[`${method}:${i}`])} onChange={(event) => setChecked((before) => ({ ...before, [`${method}:${i}`]: event.target.checked }))} /><span>{step}</span></label></li>)}</ol>
    {method === "private" && <div className="cluster-connection-command-rc46"><code>tailscale serve --bg 3000</code><ClusterCopyButton text="tailscale serve --bg 3000" size="compact">Copy command</ClusterCopyButton><small>Run on the Cluster server after installing Tailscale. Use <code>tailscale serve status</code> to see its HTTPS address.</small></div>}
    {method === "tunnel" && <div className="cluster-connection-command-rc46"><code>http://localhost:3000</code><ClusterCopyButton text="http://localhost:3000" size="compact">Copy origin service</ClusterCopyButton><small>Put this as the Tunnel service URL, not the public hostname.</small></div>}
    <div className="cluster-connection-origin-rc46"><label><span>Member-facing HTTPS URL</span><ClusterTextInput value={origin} onChange={(event) => setOrigin(event.target.value.trim())} placeholder={method === "tunnel" ? "https://cluster.yourstudio.com" : "https://server.your-tailnet.ts.net"} /></label><ClusterButton type="button" variant="secondary" disabled={!isHttpsOrigin(origin) || busy} onClick={() => onStageOrigin(origin)}>Stage URL for review</ClusterButton></div>
    <div className="button-row compact"><ClusterButton type="button" variant="secondary" disabled={busy} onClick={onReview}><ClusterIcon name="check" /> Review network configuration</ClusterButton>{target.docs && <a href={target.docs} target="_blank" rel="noopener noreferrer">{target.provider} instructions</a>}</div>
    <p className="cluster-connection-caution-rc46" role="note">Staging updates draft URLs only. You must still review, save with your security PIN, configure the external service, and test from another device. No firewall, ports, DNS, TLS, or tunnel is activated here. Only share the address after verifying remote authentication and MFA.</p>
  </section>;
}
