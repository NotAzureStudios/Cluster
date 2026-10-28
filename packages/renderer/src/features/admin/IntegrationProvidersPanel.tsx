import { useEffect, useMemo, useRef, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ResourceIdentityMark } from "../../components/ResourceIdentityMark";
import { ClusterDataTable, type ClusterDataTableColumn } from "../../components/ClusterDataTable";
import { ClusterMetricStrip } from "../../components/ClusterMetricStrip";
import { api, queryApi, setApiQueryData } from "../../core/api";

type ProviderHealth = { providerId: string; state: string; checkedAt: string; latencyMs: number; detail: string; live: boolean };
type ProviderAction = { id: string; label: string; capability: string; permission: "view" | "edit" | "manage"; destructive?: boolean };

type Provider = {
  id: string;
  label: string;
  category: string;
  version: number;
  implementation: "active" | "adapter-contract";
  capabilities: string[];
  actions: ProviderAction[];
  outboundHosts: string[];
  configured: boolean;
  configuredSettings: string[];
  missingSettings: string[];
  secretCount: number;
  projectScoped: boolean;
  healthCheck: string;
  permissionTool: string;
  setupSurface: string;
  health: ProviderHealth;
  notes?: string;
};

type ProviderResponse = {
  ok: boolean;
  contractVersion: number;
  executionModel: string;
  dynamicCodeLoading: boolean;
  permissionModel: { tool: string; reads: string; writes: string };
  providers: Provider[];
};

function providerIconId(provider: Provider) {
  const name = `${provider.id} ${provider.label}`.toLowerCase();
  if (name.includes("discord")) return "brand:discord";
  if (name.includes("steam")) return "brand:steam";
  if (name.includes("epic")) return "brand:epic";
  if (name.includes("unreal")) return "brand:unreal";
  if (name.includes("blender")) return "brand:blender";
  if (name.includes("curseforge")) return "brand:curseforge";
  if (name.includes("minecraft")) return "brand:minecraft";
  return "glyph:code";
}
function toneForHealth(state: string) {
  if (state === "healthy") return "good";
  if (["degraded", "misconfigured"].includes(state)) return "warning";
  return "";
}

export function IntegrationProvidersPanel({ excludeCategories = [] }: { excludeCategories?: readonly string[] } = {}) {
  const [data, setData] = useState<ProviderResponse | null>(null);
  const [status, setStatus] = useState("Loading provider contracts…");
  const [checking, setChecking] = useState<string | null>(null);
  const requestSequence = useRef(0);

  async function refresh(force = false) {
    const sequence = ++requestSequence.current;
    try {
      const next = await queryApi<ProviderResponse>("/api/admin/integrations/providers", { force, staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["integrations", "providers"] });
      if (sequence !== requestSequence.current) return;
      setData(next);
      const active = next.providers.filter((item) => item.implementation === "active");
      setStatus(`${active.filter((item) => item.configured).length}/${active.length} active providers configured`);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setStatus(error instanceof Error ? error.message : "Integration provider catalog unavailable.");
    }
  }

  async function checkHealth(providerId: string) {
    setChecking(providerId);
    try {
      const result = await api<{ ok: true; health: ProviderHealth }>(`/api/admin/integrations/providers/${encodeURIComponent(providerId)}/health`);
      setData((current) => {
        if (!current) return current;
        const next = { ...current, providers: current.providers.map((provider) => provider.id === providerId ? { ...provider, health: result.health } : provider) };
        setApiQueryData("/api/admin/integrations/providers", next, { staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["integrations", "providers"] });
        return next;
      });
    } finally {
      setChecking(null);
    }
  }

  useEffect(() => { void refresh(); return () => { requestSequence.current += 1; }; }, []);

  const excludedCategories = useMemo(() => new Set(excludeCategories), [excludeCategories.join("|")]);
  const providers = (data?.providers || []).filter((provider) => !excludedCategories.has(provider.category));
  const activeProviders = providers.filter((provider) => provider.implementation === "active");
  const providerColumns = useMemo<ClusterDataTableColumn<Provider>[]>(() => [
    { id: "provider", header: "Provider", hideable: false, pinnable: true, defaultWidth: 240, sortValue: (provider) => provider.label, cell: (provider) => <span className="integration-provider-identity-v521 integration-provider-identity-rc46"><ResourceIdentityMark iconId={providerIconId(provider)} label={provider.label} /><span><strong>{provider.label}</strong><small>{provider.category.replace(/-/g, " ")}</small></span></span> },
    { id: "implementation", header: "Mode", defaultWidth: 150, sortValue: (provider) => provider.implementation, cell: (provider) => provider.implementation === "active" ? "Active" : "Adapter contract" },
    { id: "configuration", header: "Configuration", defaultWidth: 160, sortValue: (provider) => provider.configured, cell: (provider) => <span className={`soft-pill ${provider.implementation === "adapter-contract" ? "" : provider.configured ? "good" : "warning"}`}>{provider.implementation === "adapter-contract" ? "Contract only" : provider.configured ? "Configured" : "Needs setup"}</span> },
    { id: "health", header: "Health", defaultWidth: 160, sortValue: (provider) => provider.health?.state || "unknown", cell: (provider) => <span className="integration-provider-health-v521"><span className={`soft-pill ${toneForHealth(provider.health?.state)}`}>{provider.health?.state || "unknown"}</span>{provider.health?.live ? <small>{provider.health.latencyMs} ms</small> : null}</span> },
    { id: "capabilities", header: "Capabilities", defaultWidth: 280, hiddenByDefault: true, sortValue: (provider) => provider.capabilities.length, cell: (provider) => provider.capabilities.length ? provider.capabilities.join(" · ") : "None" },
    { id: "permissions", header: "Permissions", defaultWidth: 180, hiddenByDefault: true, sortValue: (provider) => provider.permissionTool, cell: (provider) => `${provider.permissionTool} · view/manage` },
    { id: "network", header: "Network", defaultWidth: 220, hiddenByDefault: true, sortValue: (provider) => provider.outboundHosts.join(","), cell: (provider) => provider.outboundHosts.length ? provider.outboundHosts.join(", ") : "No outbound hosts" },
    { id: "actions", header: "Actions", hideable: false, pinnable: false, defaultWidth: 190, cell: (provider) => provider.healthCheck === "live" && provider.implementation === "active" ? <ClusterButton size="compact" variant="quiet" disabled={checking === provider.id} onClick={() => void checkHealth(provider.id)}>{checking === provider.id ? "Checking…" : "Run health check"}</ClusterButton> : provider.missingSettings.length ? <span className="muted">Missing {provider.missingSettings.join(", ")}</span> : <span className="muted">No live action</span> },
  ], [checking]);

  return (
    <section className="admin-panel-v243" data-ui-surface="integration-provider-catalog">
      <div className="admin-section-heading-v243">
        <div><h3>Integration providers</h3></div>
        <div className="button-row"><span className="soft-pill">{status}</span><ClusterButton size="compact" variant="secondary" onClick={() => void refresh(true)}>Refresh</ClusterButton></div>
      </div>
      <ClusterMetricStrip
        label="Integration provider summary"
        items={[
          { label: "Active", value: activeProviders.length, detail: "runtime providers" },
          { label: "Configured", value: activeProviders.filter((provider) => provider.configured).length, detail: `${activeProviders.length} active`, tone: activeProviders.every((provider) => provider.configured) ? "good" : "warning" },
          { label: "Healthy", value: activeProviders.filter((provider) => provider.health?.state === "healthy").length, detail: "latest checks", tone: activeProviders.some((provider) => ["degraded", "misconfigured"].includes(provider.health?.state)) ? "warning" : "good" },
          { label: "Contracts", value: providers.filter((provider) => provider.implementation === "adapter-contract").length, detail: "available adapters" },
        ]}
      />
      <ClusterDataTable rows={providers} columns={providerColumns} rowKey={(provider) => provider.id} rowLabel={(provider) => provider.label} label="Integration provider catalog" configurableColumns persistKey="admin-integration-providers" />
    </section>
  );
}
