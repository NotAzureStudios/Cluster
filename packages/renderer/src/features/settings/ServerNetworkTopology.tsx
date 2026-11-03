import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";
import { SettingsStateChip, type SettingsStateTone } from "../../components/SettingsStateChip";
import "./server-network-topology.css";

type DeploymentState = "none" | "staged" | "verified" | "rolled_back";

export type ServerNetworkTopologyProps = {
  publicWebUrl: string;
  publicApiUrl: string;
  webHost: string;
  webPort: number;
  apiHost: string;
  apiPort: number;
  directTlsConfigured?: boolean;
  allowInsecureLanHttp?: boolean;
  deploymentState?: DeploymentState | null;
  hasDraftChanges?: boolean;
};

function isHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function NetworkNode({
  icon, label, value, detail, tone = "neutral", state,
}: {
  icon: ClusterIconName;
  label: string;
  value: string;
  detail: string;
  tone?: SettingsStateTone;
  state: string;
}) {
  return <article className="cluster-network-node-v103">
    <div className="cluster-network-node-head-v103">
      <ClusterIcon name={icon} aria-hidden="true" />
      <span>{label}</span>
    </div>
    <strong title={value}>{value}</strong>
    <small>{detail}</small>
    <SettingsStateChip tone={tone}>{state}</SettingsStateChip>
  </article>;
}

/** A rendering of configuration intent, NOT a connectivity diagram backed by
 * live probes. Never use green for an untested external hop. */
export function ServerNetworkTopology({
  publicWebUrl,
  publicApiUrl,
  webHost,
  webPort,
  apiHost,
  apiPort,
  directTlsConfigured = false,
  allowInsecureLanHttp = false,
  deploymentState,
  hasDraftChanges = false,
}: ServerNetworkTopologyProps) {
  const webOrigin = publicWebUrl.trim();
  const apiOrigin = publicApiUrl.trim();
  const hasPublicOrigin = Boolean(webOrigin);
  const publicHttps = isHttpsUrl(webOrigin);
  const apiWideBind = ["0.0.0.0", "::", "[::]"].includes(apiHost);
  const webWideBind = ["0.0.0.0", "::", "[::]"].includes(webHost);
  const transport = directTlsConfigured ? "Native HTTPS configured" :
    allowInsecureLanHttp ? "Private LAN HTTP permitted" :
    publicHttps ? "HTTPS terminates at an external proxy/VPN/tunnel" : "Local HTTP";
  const state = deploymentState === "staged" ? { tone: "warning" as const, label: "Restart pending" }
    : deploymentState === "verified" ? { tone: "success" as const, label: "Local startup verified" }
    : deploymentState === "rolled_back" ? { tone: "warning" as const, label: "Previous configuration restored" }
    : { tone: "neutral" as const, label: "No staged rollout" };

  return <section className="panel cluster-network-topology-v103" aria-label="Configured network route preview">
    <header>
      <div><p className="eyebrow">Network route preview</p><h2><ClusterIcon name="cloud" aria-hidden="true" /> How members are intended to reach Cluster</h2>
        <p>These are configured endpoints and listener binds. Lines show the expected path, not a successful connection test.</p></div>
      <div className="cluster-network-topology-tags-v103">
        <SettingsStateChip tone={state.tone} icon={deploymentState === "verified" ? "check" : "refresh"}>{state.label}</SettingsStateChip>
        {hasDraftChanges && <SettingsStateChip tone="warning" icon="note">Unsaved network draft</SettingsStateChip>}
      </div>
    </header>
    <div className="cluster-network-route-v103">
      <NetworkNode icon="users" label="Members / clients" value="Browser & Desktop" detail="Remote devices require an independent access test" state="External test not run" />
      <NetworkNode icon="cloud" label="Public address / gateway" value={webOrigin || "No public URL set"} detail={apiOrigin && apiOrigin !== webOrigin ? `API origin: ${apiOrigin}` : "DNS, proxy and TLS are configured outside this view"} tone={!hasPublicOrigin ? "neutral" : publicHttps ? "info" : "warning"} state={!hasPublicOrigin ? "Not configured" : publicHttps ? "HTTPS URL configured" : "Review URL scheme"} />
      <NetworkNode icon="grid" label="Cluster Web listener" value={`${webHost}:${webPort}`} detail={`Single Web + API gateway. ${transport}. Tunnel/proxy upstreams target this listener, not the public URL.`} tone={webWideBind ? "warning" : "neutral"} state={webWideBind ? "All-interface bind configured" : "Bind configured"} />
      <NetworkNode icon="lock" label="Cluster API listener" value={`${apiHost}:${apiPort}`} detail="Private application API; do not expose it directly through the internet" tone={apiWideBind ? "warning" : "neutral"} state={apiWideBind ? "All-interface bind · review exposure" : "Bind configured"} />
    </div>
    <footer>
      <SettingsStateChip tone="neutral" icon="warning">Public DNS, TLS and external reachability not verified here</SettingsStateChip>
      <p>For Cloudflare Tunnel, Tailscale Serve and reverse proxies, use the configured local Web listener as the upstream destination. The public HTTPS address is member-facing and is not the upstream service URL. Listener changes require an authorized managed restart.</p>
    </footer>
  </section>;
}
