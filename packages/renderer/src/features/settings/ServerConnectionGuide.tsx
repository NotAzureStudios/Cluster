import { useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterCopyButton } from "../../components/ClusterCopyButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { SettingsStateChip } from "../../components/SettingsStateChip";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import "./server-connection-guide.css";

type ConnectionMethod = "local" | "lan" | "private" | "proxy" | "tunnel" | "direct";
type Guide = { title: string; provider: string; docs: string; note: string; steps: string[]; command?: string; commandNote?: string };
const METHODS: ConnectionMethod[] = ["local", "lan", "private", "proxy", "tunnel", "direct"];

function guide(method: ConnectionMethod, webPort: number): Guide {
  const localService = `http://127.0.0.1:${webPort}`;
  switch (method) {
    case "local": return {
      title: "This computer", provider: "Localhost", docs: "",
      note: "Web gateway and API remain on loopback. Nothing is accessible from other devices.",
      steps: ["Leave the gateway bind host at 127.0.0.1.", `Keep the web port at ${webPort}, or choose an unused one above.`, "Save and restart through the managed supervisor.", "Open the local web address and check Cluster health."],
      command: `http://localhost:${webPort}`, commandNote: "Browser address on this Windows server."
    };
    case "lan": return {
      title: "Trusted LAN", provider: "Local network", docs: "",
      note: "Use direct HTTPS with trusted certificate files whenever possible. Plain HTTP is an explicit less-secure exception for a private LAN only.",
      steps: ["Choose this Windows machine's fixed private IPv4/ULA address for the Web bind host, not 0.0.0.0 when using plain HTTP.", "For HTTPS, set both direct TLS file paths and a matching https:// public web URL. For plain LAN HTTP only, enable the explicit LAN HTTP acknowledgement and use http:// with the LAN address.", `Configure a restricted inbound Windows Firewall rule for the web port ${webPort} only. Never expose the API or PostgreSQL ports.`, "Restart using the native supervisor. Verify a browser connection from a second LAN device, including login."],
      command: `Web port: ${webPort}`, commandNote: "Use the server's actual LAN IP address in its member-facing URL."
    };
    case "private": return {
      title: "Private VPN", provider: "Tailscale Serve", docs: "https://tailscale.com/docs/features/tailscale-serve",
      note: "HTTPS terminates at Tailscale Serve. Cluster's web gateway stays bound to loopback; no router forwarding is needed.",
      steps: ["Install Tailscale on the Windows server and authenticate it.", "Restrict the tailnet using approved memberships and policy.", `Run Tailscale Serve for Cluster's web port ${webPort} and inspect its reported HTTPS hostname.`, "Stage that HTTPS hostname below and save/restart Cluster.", "Verify DNS, authentication, and browser/API access from a separate tailnet member device."],
      command: `tailscale serve --bg ${webPort}`, commandNote: "Run on the Windows server. Confirm the published route with tailscale serve status."
    };
    case "proxy": return {
      title: "Reverse proxy", provider: "Caddy / nginx", docs: "",
      note: "Recommended same-machine layout: TLS terminates at a vetted proxy; the local Cluster gateway stays loopback-only.",
      steps: ["Install and configure a trusted reverse proxy with a valid HTTPS certificate.", `Point the proxy's upstream service at ${localService} on this Windows machine.`, "Preserve the public Host and Origin. Restrict direct access to the loopback gateway.", "Stage the external HTTPS hostname below and save/restart Cluster.", "Verify TLS, login, API calls, redirects and WebSockets from another device."],
      command: localService, commandNote: "Proxy upstream. This is not the public address."
    };
    case "tunnel": return {
      title: "Cloudflare Tunnel", provider: "Cloudflare Tunnel", docs: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/",
      note: "External HTTPS terminates at Cloudflare. Keep the Cluster gateway local and protect your public hostname with appropriate Access policies.",
      steps: ["Install cloudflared as a managed service on the same Windows machine and authorize the tunnel.", `Create a published application route to ${localService}. Keep the request Host set to your public hostname.`, "Configure Cloudflare Access policies and MFA for studio members.", "Stage the public HTTPS hostname below and save/restart Cluster.", "Verify DNS, HTTPS, cookies, authentication, API calls and large-file transfer limits from an outside device."],
      command: localService, commandNote: "Cloudflare Tunnel origin service URL. Do not expose the API port."
    };
    case "direct": return {
      title: "Direct HTTPS", provider: "Native TLS", docs: "",
      note: "Cluster terminates HTTPS itself. Opening a public router port is optional and must be an explicit network administration decision.",
      steps: ["Select the intended private LAN or approved public gateway bind address.", "Provide readable PEM certificate and private-key file paths under Transport & TLS.", "Set the member-facing https:// address; the public port may differ from the internal web port if translated by a router.", "Review Windows Firewall and router exposure. Do not expose the Node API or PostgreSQL.", "Save, perform a supervised restart, then verify the certificate chain and authenticated access from another device."],
      command: `Gateway port: ${webPort}`, commandNote: "External routing, DNS and certificates are not provisioned by staging settings."
    };
  }
}
const isHttpsOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
};

/** Guided configuration is deliberately distinct from actual provider installation and reachability verification. */
export function ServerConnectionGuide({ onStageOrigin, onReview, busy, webPort }: {
  onStageOrigin: (origin: string) => void;
  onReview: () => void;
  busy?: boolean;
  webPort: number;
}) {
  const [method, setMethod] = useState<ConnectionMethod>("local");
  const [origin, setOrigin] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const target = guide(method, webPort);
  const complete = target.steps.filter((_, i) => checked[`${method}:${i}`]).length;
  const acceptsHttpsOrigin = method !== "local" && method !== "lan";
  return <section className="panel cluster-connection-guide-rc46" aria-label="Guided studio network access">
    <header>
      <div><span className="eyebrow">Connection assistant</span><h2>Connect your team</h2><p>Select an access method and apply a real managed listener configuration. The API and database stay private.</p></div>
      <SettingsStateChip tone="info" icon="list">{complete}/{target.steps.length} manual steps marked</SettingsStateChip>
    </header>
    <div className="cluster-connection-methods-rc46" role="group" aria-label="Connection method">
      {METHODS.map((choice) => <ClusterButton key={choice} unstyled type="button" className={method === choice ? "active" : ""} aria-pressed={method === choice} onClick={() => setMethod(choice)}>
        <ClusterIcon name={choice === "private" || choice === "local" ? "lock" : choice === "tunnel" ? "cloud" : "users"} /><span>{guide(choice, webPort).title}</span>
      </ClusterButton>)}
    </div>
    <div className="cluster-connection-guide-subhead-rc46"><strong>{target.provider}</strong>
      <SettingsStateChip tone={method === "lan" || method === "direct" ? "warning" : "info"} icon={method === "tunnel" ? "cloud" : "lock"}>
        {method === "lan" ? "Firewall review required" : method === "direct" ? "Certificate required" : "Manual external verification"}
      </SettingsStateChip>
      <span>{target.note}</span>
    </div>
    <ol className="cluster-connection-steps-rc46">
      {target.steps.map((step, i) => <li key={`${method}:${i}`}><label>
        <input type="checkbox" checked={Boolean(checked[`${method}:${i}`])} onChange={(event) => setChecked((before) => ({ ...before, [`${method}:${i}`]: event.target.checked }))} />
        <span>{step}</span>
      </label></li>)}
    </ol>
    {target.command && <div className="cluster-connection-command-rc46"><code>{target.command}</code><ClusterCopyButton text={target.command} size="compact">Copy</ClusterCopyButton><small>{target.commandNote}</small></div>}
    {acceptsHttpsOrigin && <div className="cluster-connection-origin-rc46">
      <label><span>Member-facing HTTPS URL</span><ClusterTextInput value={origin} onChange={(event) => setOrigin(event.target.value.trim())} placeholder={method === "private" ? "https://server.your-tailnet.ts.net" : "https://cluster.yourstudio.com"} /></label>
      <ClusterButton type="button" variant="secondary" disabled={!isHttpsOrigin(origin) || busy} onClick={() => onStageOrigin(origin)}>Stage URL for review</ClusterButton>
    </div>}
    <div className="button-row compact"><ClusterButton type="button" variant="secondary" disabled={busy} onClick={onReview}><ClusterIcon name="check" /> Review network configuration</ClusterButton>{target.docs && <a href={target.docs} target="_blank" rel="noopener noreferrer">{target.provider} instructions</a>}</div>
    <p className="cluster-connection-caution-rc46" role="note">Checklist marks and saved settings are not connectivity proof. A managed restart verifies local readiness only. DNS, TLS, firewall, tunnel/VPN provider and a separate client connection must be checked independently before sharing access.</p>
  </section>;
}
