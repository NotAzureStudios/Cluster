import type { SettingPayload } from "../../app/server-composition-types.js";

export type IntegrationCapability =
  | "source.read"
  | "source.write"
  | "issues.read"
  | "issues.write"
  | "releases.read"
  | "chat.read"
  | "chat.write"
  | "webhook.send"
  | "identity.link"
  | "interaction.receive"
  | "notification.deliver"
  | "media.embed"
  | "calendar.read"
  | "calendar.write"
  | "mail.send"
  | "build.read"
  | "build.write"
  | "storage.read"
  | "storage.write"
  | "api.read"
  | "api.write";

export type IntegrationPermissionLevel = "view" | "edit" | "manage";
export type IntegrationProviderImplementation = "active" | "adapter-contract";

export type IntegrationProviderAction = {
  id: string;
  label: string;
  capability: IntegrationCapability;
  permission: IntegrationPermissionLevel;
  destructive?: boolean;
};

export type IntegrationProviderManifest = {
  id: string;
  label: string;
  category: "source-control" | "communication" | "media" | "automation" | "calendar" | "build" | "storage";
  version: number;
  builtIn: boolean;
  implementation: IntegrationProviderImplementation;
  capabilities: readonly IntegrationCapability[];
  actions: readonly IntegrationProviderAction[];
  settingKeys: readonly (keyof SettingPayload)[];
  secretSettingKeys: readonly (keyof SettingPayload)[];
  outboundHosts: readonly string[];
  projectScoped: boolean;
  healthCheck: "none" | "configuration" | "live";
  permissionTool: "integrations";
  setupSurface: string;
  notes?: string;
};

export type IntegrationProviderSnapshot = IntegrationProviderManifest & {
  configured: boolean;
  configuredSettings: string[];
  missingSettings: string[];
  secretCount: number;
};

const PROVIDER_ID = /^[a-z0-9][a-z0-9.-]{1,63}$/;
const ACTION_ID = /^[a-z0-9][a-z0-9._-]{1,79}$/;

function assertManifest(manifest: IntegrationProviderManifest) {
  if (!PROVIDER_ID.test(manifest.id)) throw new Error(`Invalid integration provider id: ${manifest.id}`);
  if (!manifest.label.trim()) throw new Error(`Integration provider ${manifest.id} requires a label.`);
  if (!Number.isInteger(manifest.version) || manifest.version < 1) throw new Error(`Integration provider ${manifest.id} requires a positive contract version.`);
  const settingKeys = new Set(manifest.settingKeys.map(String));
  for (const key of manifest.secretSettingKeys) {
    if (!settingKeys.has(String(key))) throw new Error(`Integration provider ${manifest.id} secret key ${String(key)} is not declared in settingKeys.`);
  }
  if (new Set(manifest.capabilities).size !== manifest.capabilities.length) throw new Error(`Integration provider ${manifest.id} contains duplicate capabilities.`);
  const actionIds = new Set<string>();
  const capabilitySet = new Set(manifest.capabilities);
  for (const action of manifest.actions) {
    if (!ACTION_ID.test(action.id)) throw new Error(`Integration provider ${manifest.id} has invalid action id ${action.id}.`);
    if (actionIds.has(action.id)) throw new Error(`Integration provider ${manifest.id} contains duplicate action ${action.id}.`);
    if (!capabilitySet.has(action.capability)) throw new Error(`Integration provider ${manifest.id} action ${action.id} references undeclared capability ${action.capability}.`);
    actionIds.add(action.id);
  }
}

export class IntegrationProviderRegistry {
  readonly #providers = new Map<string, IntegrationProviderManifest>();

  register(manifest: IntegrationProviderManifest) {
    assertManifest(manifest);
    if (this.#providers.has(manifest.id)) throw new Error(`Integration provider ${manifest.id} is already registered.`);
    this.#providers.set(manifest.id, Object.freeze({
      ...manifest,
      capabilities: Object.freeze([...manifest.capabilities]),
      actions: Object.freeze(manifest.actions.map((action) => Object.freeze({ ...action }))),
      settingKeys: Object.freeze([...manifest.settingKeys]),
      secretSettingKeys: Object.freeze([...manifest.secretSettingKeys]),
      outboundHosts: Object.freeze([...manifest.outboundHosts]),
    }));
    return this;
  }

  get(id: string) {
    return this.#providers.get(id) || null;
  }

  manifests() {
    return [...this.#providers.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  snapshot(settings: SettingPayload): IntegrationProviderSnapshot[] {
    return this.manifests().map((manifest) => {
      const configuredSettings = manifest.settingKeys.filter((key) => {
        const value = settings[key];
        return value !== undefined && value !== null && value !== "" && value !== false;
      }).map(String);
      const required = manifest.settingKeys.filter((key) => !manifest.secretSettingKeys.includes(key));
      let missingSettings = required.filter((key) => {
        const value = settings[key];
        return value === undefined || value === null || value === "" || value === false;
      }).map(String);
      let configured = configuredSettings.length > 0 && missingSettings.length === 0;
      if (manifest.category === "source-control") configured = false;
      if (manifest.id === "communication.discord") {
        const botConfigured = Boolean(settings.discordBotToken && settings.discordGuildId);
        const webhookConfigured = Boolean(settings.discordWebhookUrl);
        configured = botConfigured || webhookConfigured;
        missingSettings = configured ? [] : ["discordBotToken + discordGuildId, or discordWebhookUrl"];
      }
      if (manifest.id === "media.youtube") configured = Boolean(settings.libraryAllowYoutube);
      if (manifest.id === "automation.cluster-webhooks" || manifest.id === "api.cluster-public") configured = true;
      if (manifest.implementation === "adapter-contract") configured = false;
      return {
        ...manifest,
        configured,
        configuredSettings,
        missingSettings,
        secretCount: manifest.secretSettingKeys.filter((key) => Boolean(settings[key])).length,
      };
    });
  }
}

export function createBuiltInIntegrationRegistry() {
  return new IntegrationProviderRegistry()
    .register({
      id: "source.gitea",
      label: "Gitea",
      category: "source-control",
      version: 3,
      builtIn: true,
      implementation: "active",
      capabilities: ["source.read", "source.write", "issues.read", "issues.write", "releases.read", "build.read"],
      actions: [
        { id: "repo.read", label: "Read repository metadata", capability: "source.read", permission: "view" },
        { id: "repo.sync", label: "Synchronize branches and commit history", capability: "source.read", permission: "edit" },
        { id: "issues.read", label: "Read issues", capability: "issues.read", permission: "view" },
        { id: "issues.write", label: "Create and update issues", capability: "issues.write", permission: "manage" },
        { id: "repo.import", label: "Import repository work", capability: "source.write", permission: "manage" },
        { id: "releases.read", label: "Read releases", capability: "releases.read", permission: "view" },
      ],
      settingKeys: [],
      secretSettingKeys: [],
      outboundHosts: ["operator-configured-git-host"],
      projectScoped: true,
      healthCheck: "live",
      permissionTool: "integrations",
      setupSurface: "administration:source-control",
      notes: "Private-network access remains opt-in through the existing Git security boundary.",
    })
    .register({
      id: "source.github",
      label: "GitHub",
      category: "source-control",
      version: 1,
      builtIn: true,
      implementation: "active",
      capabilities: ["source.read", "source.write", "issues.read", "issues.write", "releases.read"],
      actions: [
        { id: "repo.read", label: "Read repository metadata", capability: "source.read", permission: "view" },
        { id: "repo.write", label: "Publish source changes", capability: "source.write", permission: "manage" },
      ],
      settingKeys: [], secretSettingKeys: [], outboundHosts: ["github.com", "api.github.com"], projectScoped: true,
      healthCheck: "live", permissionTool: "integrations", setupSurface: "administration:source-control",
      notes: "Uses Cluster's provider-neutral Source Control model.",
    })
    .register({
      id: "source.gitlab",
      label: "GitLab",
      category: "source-control",
      version: 1,
      builtIn: true,
      implementation: "active",
      capabilities: ["source.read", "source.write", "issues.read", "issues.write", "releases.read"],
      actions: [
        { id: "repo.read", label: "Read repository metadata", capability: "source.read", permission: "view" },
        { id: "repo.write", label: "Publish source changes", capability: "source.write", permission: "manage" },
      ],
      settingKeys: [], secretSettingKeys: [], outboundHosts: ["gitlab.com"], projectScoped: true,
      healthCheck: "live", permissionTool: "integrations", setupSurface: "administration:source-control",
      notes: "Uses Cluster's provider-neutral Source Control model.",
    })
    .register({
      id: "source.forgejo",
      label: "Forgejo",
      category: "source-control",
      version: 1,
      builtIn: true,
      implementation: "active",
      capabilities: ["source.read", "source.write", "issues.read", "issues.write", "releases.read"],
      actions: [
        { id: "repo.read", label: "Read repository metadata", capability: "source.read", permission: "view" },
        { id: "repo.write", label: "Publish source changes", capability: "source.write", permission: "manage" },
      ],
      settingKeys: [], secretSettingKeys: [], outboundHosts: ["operator-configured-git-host"], projectScoped: true,
      healthCheck: "live", permissionTool: "integrations", setupSurface: "administration:source-control",
      notes: "Uses Cluster's provider-neutral Source Control model.",
    })
    .register({
      id: "communication.discord",
      label: "Discord",
      category: "communication",
      version: 3,
      builtIn: true,
      implementation: "active",
      capabilities: ["chat.read", "chat.write", "webhook.send", "identity.link", "interaction.receive", "notification.deliver"],
      actions: [
        { id: "chat.read", label: "Read configured channels", capability: "chat.read", permission: "view" },
        { id: "chat.write", label: "Send messages and create threads", capability: "chat.write", permission: "manage" },
        { id: "webhook.send", label: "Send webhook notifications", capability: "webhook.send", permission: "manage" },
        { id: "identity.link", label: "Link Discord identities", capability: "identity.link", permission: "edit" },
        { id: "interaction.receive", label: "Receive signed Discord actions", capability: "interaction.receive", permission: "edit" },
        { id: "notification.deliver", label: "Deliver Cluster Inbox updates", capability: "notification.deliver", permission: "manage" },
      ],
      settingKeys: ["discordGuildId", "discordChatChannelId", "discordBotToken", "discordWebhookUrl", "discordApplicationId", "discordApplicationPublicKey"],
      secretSettingKeys: ["discordBotToken", "discordWebhookUrl"],
      outboundHosts: ["discord.com", "discordapp.com"],
      projectScoped: true,
      healthCheck: "live",
      permissionTool: "integrations",
      setupSurface: "administration:discord",
    })
    .register({
      id: "media.youtube",
      label: "YouTube embeds",
      category: "media",
      version: 2,
      builtIn: true,
      implementation: "active",
      capabilities: ["media.embed"],
      actions: [{ id: "embed", label: "Embed allowed YouTube media", capability: "media.embed", permission: "view" }],
      settingKeys: ["libraryAllowYoutube"],
      secretSettingKeys: [],
      outboundHosts: ["youtube.com", "youtu.be", "youtube-nocookie.com"],
      projectScoped: true,
      healthCheck: "configuration",
      permissionTool: "integrations",
      setupSurface: "studio-settings:library",
      notes: "Embed capability only. Cluster does not require a YouTube API credential.",
    })
    .register({
      id: "automation.cluster-webhooks",
      label: "Cluster outbound webhooks",
      category: "automation",
      version: 1,
      builtIn: true,
      implementation: "active",
      capabilities: ["webhook.send", "build.write", "calendar.write", "mail.send", "storage.write"],
      actions: [
        { id: "endpoint.manage", label: "Manage signed webhook endpoints", capability: "webhook.send", permission: "manage", destructive: true },
        { id: "delivery.retry", label: "Retry failed deliveries", capability: "webhook.send", permission: "manage" },
      ],
      settingKeys: [], secretSettingKeys: [], outboundHosts: ["endpoint-specific"], projectScoped: true,
      healthCheck: "configuration", permissionTool: "integrations", setupSurface: "server-config:webhooks",
      notes: "Generic signed delivery surface for CI, email relays, calendar bridges, storage automation, and other HTTP integrations.",
    })
    .register({
      id: "api.cluster-public",
      label: "Cluster Public API",
      category: "automation",
      version: 1,
      builtIn: true,
      implementation: "active",
      capabilities: ["api.read", "api.write", "build.read", "build.write", "calendar.read", "storage.read"],
      actions: [
        { id: "api.read", label: "Read scoped resources", capability: "api.read", permission: "view" },
        { id: "api.write", label: "Write scoped resources", capability: "api.write", permission: "manage" },
      ],
      settingKeys: [], secretSettingKeys: [], outboundHosts: [], projectScoped: true,
      healthCheck: "configuration", permissionTool: "integrations", setupSurface: "server-config:public-api",
      notes: "Machine identity uses Block M scoped credentials; API tokens never become browser sessions.",
    })
    .register({
      id: "communication.email",
      label: "Email adapter contract",
      category: "communication",
      version: 1,
      builtIn: true,
      implementation: "adapter-contract",
      capabilities: ["mail.send"],
      actions: [{ id: "mail.send", label: "Send transactional mail", capability: "mail.send", permission: "manage" }],
      settingKeys: [], secretSettingKeys: [], outboundHosts: [], projectScoped: false,
      healthCheck: "none", permissionTool: "integrations", setupSurface: "provider-adapter:email",
      notes: "Reserved provider contract. Use signed webhooks for an email relay until a native mail transport is configured.",
    })
    .register({
      id: "calendar.external",
      label: "External calendar adapter contract",
      category: "calendar",
      version: 1,
      builtIn: true,
      implementation: "adapter-contract",
      capabilities: ["calendar.read", "calendar.write"],
      actions: [
        { id: "calendar.read", label: "Read external calendar events", capability: "calendar.read", permission: "view" },
        { id: "calendar.write", label: "Publish calendar changes", capability: "calendar.write", permission: "manage" },
      ],
      settingKeys: [], secretSettingKeys: [], outboundHosts: [], projectScoped: true,
      healthCheck: "none", permissionTool: "integrations", setupSurface: "provider-adapter:calendar",
      notes: "Reserved for CalDAV/provider adapters. Cluster's public API and signed webhooks remain the supported bridge surface in this source boundary.",
    })
    .register({
      id: "storage.external",
      label: "External storage adapter contract",
      category: "storage",
      version: 1,
      builtIn: true,
      implementation: "adapter-contract",
      capabilities: ["storage.read", "storage.write"],
      actions: [
        { id: "storage.read", label: "Read external objects", capability: "storage.read", permission: "view" },
        { id: "storage.write", label: "Write external objects", capability: "storage.write", permission: "manage" },
      ],
      settingKeys: [], secretSettingKeys: [], outboundHosts: [], projectScoped: true,
      healthCheck: "none", permissionTool: "integrations", setupSurface: "provider-adapter:storage",
      notes: "Reserved for S3/WebDAV/provider adapters. The Public API exposes Cluster asset metadata under scoped machine credentials.",
    });
}
