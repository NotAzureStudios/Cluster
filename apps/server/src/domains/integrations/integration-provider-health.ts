import type { SettingPayload } from "../../app/server-composition-types.js";
import { MailSendError, describeMailConfiguration, verifyMailConfiguration } from "../../core/mail-transport.js";
import type { IntegrationProviderManifest, IntegrationProviderRegistry } from "./integration-provider-registry.js";

export type IntegrationProviderHealthState = "healthy" | "degraded" | "misconfigured" | "disabled" | "contract-only" | "unknown";

export type IntegrationProviderHealth = {
  providerId: string;
  state: IntegrationProviderHealthState;
  checkedAt: string;
  latencyMs: number;
  detail: string;
  live: boolean;
};

function configuredValue(value: unknown) {
  return value !== undefined && value !== null && value !== "" && value !== false;
}

function configurationHealth(manifest: IntegrationProviderManifest, settings: SettingPayload): IntegrationProviderHealth {
  const startedAt = Date.now();
  if (manifest.implementation === "adapter-contract") {
    return { providerId: manifest.id, state: "contract-only", checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, detail: manifest.notes || "Provider adapter contract is reserved but no runtime adapter is enabled.", live: false };
  }
  if (manifest.id === "automation.cluster-webhooks" || manifest.id === "api.cluster-public") {
    return { providerId: manifest.id, state: "healthy", checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, detail: "Built-in Cluster integration surface is available.", live: false };
  }
  if (manifest.id === "media.youtube") {
    const enabled = Boolean(settings.libraryAllowYoutube);
    return { providerId: manifest.id, state: enabled ? "healthy" : "disabled", checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, detail: enabled ? "YouTube embedding is enabled." : "YouTube embedding is disabled by Studio Library policy.", live: false };
  }
  if (manifest.id === "communication.discord") {
    const botConfigured = Boolean(settings.discordBotToken && settings.discordGuildId);
    const webhookConfigured = Boolean(settings.discordWebhookUrl);
    if (!botConfigured && !webhookConfigured) return { providerId: manifest.id, state: "misconfigured", checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, detail: "Configure a Discord bot/guild or webhook endpoint.", live: false };
    return { providerId: manifest.id, state: "healthy", checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, detail: botConfigured ? "Discord bot and guild configuration is present." : "Discord webhook delivery is configured.", live: false };
  }
  if (manifest.id === "communication.email") {
    // Mail has its own notion of "configured" — a default port and a sender
    // derived from the username — so the generic required-keys check below
    // would report a working setup as incomplete, and would read
    // mailEnabled: false as missing rather than deliberately off.
    const described = describeMailConfiguration(settings);
    const checkedAt = new Date().toISOString();
    if (described.configured) {
      return { providerId: manifest.id, state: "healthy", checkedAt, latencyMs: Date.now() - startedAt, detail: `SMTP is configured for ${described.host}:${described.port} as ${described.fromAddress}.`, live: false };
    }
    const off = settings.mailEnabled === false;
    return { providerId: manifest.id, state: off ? "disabled" : "misconfigured", checkedAt, latencyMs: Date.now() - startedAt, detail: described.reason || "Outbound mail is not configured.", live: false };
  }
  const required = manifest.settingKeys.filter((key) => !manifest.secretSettingKeys.includes(key));
  const missing = required.filter((key) => !configuredValue(settings[key]));
  if (missing.length) {
    return { providerId: manifest.id, state: "misconfigured", checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, detail: `Missing required configuration: ${missing.map(String).join(", ")}.`, live: false };
  }
  return { providerId: manifest.id, state: "healthy", checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, detail: "Configuration contract is satisfied.", live: false };
}

export function createIntegrationProviderHealthService(input: {
  registry: IntegrationProviderRegistry;
  readSettings: (force?: boolean) => Promise<SettingPayload>;
  discordRequest?: (settings: SettingPayload, path: string, options?: { method?: string; body?: unknown }) => Promise<any>;
}) {
  async function check(providerId: string): Promise<IntegrationProviderHealth | null> {
    const manifest = input.registry.get(providerId);
    if (!manifest) return null;
    const settings = await input.readSettings();
    const base = configurationHealth(manifest, settings);
    if (base.state !== "healthy" || manifest.healthCheck !== "live") return base;

    const startedAt = Date.now();
    try {
      if (manifest.id === "communication.discord") {
        if (!settings.discordBotToken || !settings.discordGuildId) {
          const webhookOnly = Boolean(settings.discordWebhookUrl);
          return {
            providerId: manifest.id,
            state: webhookOnly ? "healthy" : "misconfigured",
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - startedAt,
            detail: webhookOnly ? "Discord webhook delivery is configured; bot-backed live health is unavailable without bot token and guild ID." : "Configure a Discord bot/guild or webhook endpoint.",
            live: false,
          };
        }
        if (!input.discordRequest) return { ...base, state: "unknown", detail: "Discord live-health adapter is not wired.", checkedAt: new Date().toISOString() };
        const guild = await input.discordRequest(settings, `/guilds/${encodeURIComponent(settings.discordGuildId)}`);
        return {
          providerId: manifest.id,
          state: "healthy",
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
          detail: `Discord guild ${String(guild?.name || settings.discordGuildId).slice(0, 160)} is reachable.`,
          live: true,
        };
      }
      if (manifest.id === "communication.email") {
        // Connect and authenticate without sending: the only way to tell an
        // administrator their app password works before real mail needs it.
        const verified = await verifyMailConfiguration(settings);
        return {
          providerId: manifest.id,
          state: "healthy",
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
          detail: `Authenticated with ${verified.host}:${verified.port} over ${verified.secure ? "TLS" : "STARTTLS"}; sending as ${verified.fromAddress}.`,
          live: true,
        };
      }
      return { ...base, checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt };
    } catch (error) {
      // A credential the server refuses outright is a configuration fault, not
      // a transient one; calling it "degraded" would suggest waiting helps.
      if (error instanceof MailSendError && error.permanent) {
        return { providerId: manifest.id, state: "misconfigured", checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, detail: error.message.slice(0, 500), live: true };
      }
      return {
        providerId: manifest.id,
        state: "degraded",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        detail: error instanceof Error ? error.message.slice(0, 500) : "Provider live health check failed.",
        live: true,
      };
    }
  }

  async function snapshot(options: { live?: boolean } = {}) {
    const settings = await input.readSettings();
    const providers = input.registry.snapshot(settings);
    const health = await Promise.all(providers.map(async (provider) => {
      if (options.live) return check(provider.id);
      return configurationHealth(provider, settings);
    }));
    return providers.map((provider, index) => ({ ...provider, health: health[index] }));
  }

  return { check, snapshot };
}
