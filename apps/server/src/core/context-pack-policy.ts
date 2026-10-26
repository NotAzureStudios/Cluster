/** Context Pack transport boundary. Never pass untrusted stored/imported JSON directly to a client. */
export const CONTEXT_PACK_SETTING_KEYS = [
  "discordWebhookUrl", "discordVoiceUrl", "discordMessagePrefix", "discordBotToken",
  "discordGuildId", "discordForumChannelId", "discordChatChannelId", "discordAdminRoleId",
  "discordApplicationId", "discordApplicationPublicKey", "fontFamily", "accentColor",
  "secondaryAccentColor", "dangerColor", "backgroundStyle", "cardStyle", "motionLevel",
  "tagPresetCsv", "defaultCardPriority", "defaultCardLabels",
] as const;
export const CONTEXT_PACK_SECRET_KEYS = new Set<string>(["discordWebhookUrl", "discordBotToken"]);
const MAX_IMPORT_BYTES = 128 * 1024;
const MAX_FIELD_BYTES = 8 * 1024;
const ALLOWED_KEYS = new Set<string>(CONTEXT_PACK_SETTING_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class ContextPackValidationError extends Error {
  readonly code = "CONTEXT_PACK_INVALID";
}

/** Reject unexpected fields instead of storing opaque configuration with possible secret payloads. */
export function validateContextPackImport(value: unknown) {
  if (!isRecord(value) || !isRecord(value.settings)) throw new ContextPackValidationError("A Context Pack must contain a settings object.");
  const serialized = JSON.stringify(value);
  if (!serialized || Buffer.byteLength(serialized, "utf8") > MAX_IMPORT_BYTES) throw new ContextPackValidationError("Context Pack exceeds the import size limit.");
  if (value.kind !== undefined && value.kind !== "cluster.context-pack") throw new ContextPackValidationError("Unsupported Context Pack kind.");
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) throw new ContextPackValidationError("Unsupported Context Pack schema version.");
  const settings: Record<string, string> = {};
  for (const [key, input] of Object.entries(value.settings)) {
    if (!ALLOWED_KEYS.has(key)) throw new ContextPackValidationError(`Unknown Context Pack setting: ${key}`);
    if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > MAX_FIELD_BYTES) throw new ContextPackValidationError(`Invalid Context Pack setting: ${key}`);
    settings[key] = input;
  }
  return { schemaVersion: 1, app: "Cluster", kind: "cluster.context-pack" as const,
    exportedAt: new Date().toISOString(), includesSecrets: containsContextPackSecrets({ settings }), settings };
}

export function containsContextPackSecrets(value: unknown) {
  const settings = isRecord(value) && isRecord(value.settings) ? value.settings : {};
  return [...CONTEXT_PACK_SECRET_KEYS].some((key) => typeof settings[key] === "string" && Boolean(settings[key]));
}

/** Safe projections never reveal secret fields or opaque imported metadata. */
export function projectContextPackPayload(value: unknown, revealSecrets = false) {
  const settings = isRecord(value) && isRecord(value.settings) ? value.settings : {};
  const safe: Record<string, string> = {};
  for (const key of CONTEXT_PACK_SETTING_KEYS) {
    if (CONTEXT_PACK_SECRET_KEYS.has(key) && !revealSecrets) continue;
    if (typeof settings[key] === "string") safe[key] = settings[key] as string;
  }
  const hasSecrets = containsContextPackSecrets(value);
  return { schemaVersion: 1, app: "Cluster", kind: "cluster.context-pack", settings: safe,
    includesSecrets: revealSecrets && hasSecrets, secretsRedacted: !revealSecrets && hasSecrets };
}
