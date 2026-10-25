/** The ONLY non-secret settings accepted from a first-run .clusterconfig bundle. */
export const CLUSTER_CONFIG_FIELDS = [
  "studioName", "studioTimezone", "defaultCreateStarterBoard",
  "defaultCreateStarterWhiteboard", "defaultCreateStarterLibrary",
] as const;
export type ClusterConfigField = typeof CLUSTER_CONFIG_FIELDS[number];
export type SafeStudioConfig = Partial<{
  studioName: string;
  studioTimezone: string;
  defaultCreateStarterBoard: boolean;
  defaultCreateStarterWhiteboard: boolean;
  defaultCreateStarterLibrary: boolean;
}>;
export type ClusterConfigBundle = {
  format: "clusterconfig";
  schemaVersion: 1;
  settings: SafeStudioConfig;
};
const FIELDS: ReadonlySet<string> = new Set(CLUSTER_CONFIG_FIELDS);
const BOOLEAN_FIELDS: ReadonlySet<string> = new Set([
  "defaultCreateStarterBoard", "defaultCreateStarterWhiteboard", "defaultCreateStarterLibrary",
]);
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedString(value: unknown, key: string) {
  if (typeof value !== "string") throw new Error(`${key} must be text.`);
  const result = value.trim();
  if (!result || result.length > 120) throw new Error(`${key} must contain 1–120 characters.`);
  return result;
}
export function validateSafeStudioSettings(input: unknown): SafeStudioConfig {
  if (!record(input)) throw new Error("Configuration settings must be an object.");
  const result: SafeStudioConfig = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!FIELDS.has(key)) throw new Error(`Setting '${key}' is not allowed in .clusterconfig imports.`);
    if (BOOLEAN_FIELDS.has(key)) {
      if (typeof raw !== "boolean") throw new Error(`${key} must be true or false.`);
      (result as Record<string, unknown>)[key] = raw;
    } else if (key === "studioTimezone") {
      const zone = boundedString(raw, key);
      try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); }
      catch { throw new Error("studioTimezone must be a valid IANA timezone."); }
      result.studioTimezone = zone;
    } else if (key === "studioName") result.studioName = boundedString(raw, key);
  }
  return result;
}
export function parseClusterConfigBundle(input: unknown): ClusterConfigBundle {
  if (!record(input) || input.format !== "clusterconfig" || input.schemaVersion !== 1) {
    throw new Error("Not a supported .clusterconfig bundle (schema 1 required).");
  }
  if (Object.keys(input).some((key) => !["format", "schemaVersion", "settings"].includes(key))) {
    throw new Error("Unexpected .clusterconfig envelope fields. Only format, schemaVersion, and settings are accepted.");
  }
  return { format: "clusterconfig", schemaVersion: 1, settings: validateSafeStudioSettings(input.settings) };
}
export function exportSafeStudioConfiguration(settings: object): ClusterConfigBundle {
  const source = settings as Record<string, unknown>;
  const candidate: Record<string, unknown> = {};
  for (const key of CLUSTER_CONFIG_FIELDS) {
    const value = source[key];
    if (value === undefined || value === null || value === "") continue;
    candidate[key] = value;
  }
  return { format: "clusterconfig", schemaVersion: 1, settings: validateSafeStudioSettings(candidate) };
}

export const SETUP_CHECKLIST_IDS = [
  "owner-passkey", "recovery-codes", "studio-identity", "studio-timezone", "backups", "second-admin", "first-project", "domains",
] as const;
export type SetupChecklistId = typeof SETUP_CHECKLIST_IDS[number];
export function sanitizeSkippedSetupItems(input: unknown): SetupChecklistId[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((value): value is SetupChecklistId =>
    typeof value === "string" && value !== "owner-passkey" && value !== "recovery-codes" && (SETUP_CHECKLIST_IDS as readonly string[]).includes(value),
  ))];
}

/**
 * Preview only the explicitly allowlisted keys. No server credentials, storage
 * paths, or unmentioned settings are ever projected or mutated by this plan.
 * A preview fingerprint is calculated by the authenticated route against both
 * the incoming values and the current values of every requested setting.
 */
export type SafeConfigurationChange = {
  key: ClusterConfigField;
  before: string | boolean | null;
  after: string | boolean;
};
export type SafeConfigurationPlan = {
  changes: SafeConfigurationChange[];
  requested: SafeStudioConfig;
  comparisonState: Array<{ key: ClusterConfigField; before: string | boolean | null; after: string | boolean }>;
};

export function planSafeStudioConfiguration(bundle: ClusterConfigBundle, current: object): SafeConfigurationPlan {
  // Validating here as well prevents callers from accidentally bypassing the parser.
  const requested = parseClusterConfigBundle(bundle).settings;
  const source = current as Record<string, unknown>;
  const comparisonState: SafeConfigurationPlan["comparisonState"] = [];
  const changes: SafeConfigurationChange[] = [];
  for (const key of CLUSTER_CONFIG_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(requested, key)) continue;
    const after = requested[key];
    if (typeof after !== "string" && typeof after !== "boolean") continue;
    const rawBefore = source[key];
    const before = typeof rawBefore === "string" ? rawBefore.trim()
      : typeof rawBefore === "boolean" ? rawBefore : null;
    const entry = { key, before, after };
    comparisonState.push(entry);
    if (before !== after) changes.push(entry);
  }
  return { changes, requested, comparisonState };
}


/**
 * A rollback is deliberately NOT a .clusterconfig import. It can delete an
 * originally absent AppSetting row, and it is permitted only when the current
 * database value still equals the recorded outcome of the chosen revision.
 * An older revision cannot silently overwrite an intervening admin edit.
 */
export type SafeConfigurationRollbackChange = {
  key: ClusterConfigField;
  before: string | boolean | null;
  after: string | boolean | null;
};

export function parseSafeConfigurationRevisionChanges(input: unknown): SafeConfigurationRollbackChange[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > CLUSTER_CONFIG_FIELDS.length) {
    throw new Error("Configuration revision does not contain a valid change set.");
  }
  const seen = new Set<string>();
  return input.map((raw): SafeConfigurationRollbackChange => {
    if (!record(raw) || Object.keys(raw).some((key) => !["key", "before", "after"].includes(key)) ||
        typeof raw.key !== "string" || !FIELDS.has(raw.key) || seen.has(raw.key)) {
      throw new Error("Configuration revision contains unsupported or repeated keys.");
    }
    seen.add(raw.key);
    for (const stage of ["before", "after"] as const) {
      if (!Object.prototype.hasOwnProperty.call(raw, stage)) throw new Error("Configuration revision has incomplete values.");
      if (raw[stage] !== null) {
        // Reuse the same narrow validators as imports, including IANA timezone
        // and boolean-vs-string type checks. Never trust historical JSON blindly.
        validateSafeStudioSettings({ [raw.key]: raw[stage] });
      }
    }
    if (raw.before === raw.after) throw new Error("Configuration revision contains a no-op change.");
    return { key: raw.key as ClusterConfigField, before: raw.before as string | boolean | null, after: raw.after as string | boolean | null };
  });
}

export function planSafeConfigurationRollback(
  changesInput: unknown,
  current: object,
): { changes: SafeConfigurationRollbackChange[]; conflictingKeys: ClusterConfigField[] } {
  const history = parseSafeConfigurationRevisionChanges(changesInput);
  const source = current as Record<string, unknown>;
  const conflictingKeys: ClusterConfigField[] = [];
  const changes: SafeConfigurationRollbackChange[] = [];
  for (const entry of history) {
    const raw = source[entry.key];
    const present = Object.prototype.hasOwnProperty.call(source, entry.key);
    const currentValue = typeof raw === "string" ? raw.trim() : typeof raw === "boolean" ? raw : null;
    // An absent override is not an explicit JSON null. Earlier revision
    // history represents absence as null, so require actual row absence when
    // reversing such a revision; don't silently treat an invalid stored value
    // as proof that the expected revision state still exists.
    const matches = entry.after === null ? !present : present && currentValue === entry.after;
    if (!matches) conflictingKeys.push(entry.key);
    else changes.push({ key: entry.key, before: currentValue, after: entry.before });
  }
  return { changes, conflictingKeys };
}
