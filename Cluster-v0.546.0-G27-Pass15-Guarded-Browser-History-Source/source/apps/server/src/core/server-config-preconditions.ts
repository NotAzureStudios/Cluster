/**
 * Server Configuration preconditions operate on the admin-safe read projection.
 * They prevent blind whole-object saves; the file+database commit protocol remains
 * a separate cross-process/crash-recovery concern.
 */
export type ServerConfigExpectedField = { exists: boolean; value?: unknown };

export function checkServerConfigPreconditions(
  current: Record<string, unknown>,
  changes: Record<string, unknown>,
  expected: Record<string, ServerConfigExpectedField> | undefined,
  options: { checkValues?: boolean } = {},
): { conflicts: string[] } {
  const keys = Object.keys(changes);
  if (!expected || !keys.length || Object.keys(expected).length !== keys.length) {
    throw new Error("Every edited server configuration field requires an original-value precondition.");
  }
  for (const key of keys) {
    const entry = Object.prototype.hasOwnProperty.call(expected, key) ? expected[key] : undefined;
    if (!entry || typeof entry.exists !== "boolean" || (entry.exists && !Object.prototype.hasOwnProperty.call(entry, "value"))) {
      throw new Error(`Missing or invalid precondition for ${key}.`);
    }
    if (key === "__proto__" || key === "prototype" || key === "constructor") throw new Error("Unsafe setting key.");
  }
  if (options.checkValues === false) return { conflicts: [] };
  const conflicts: string[] = [];
  for (const key of keys) {
    const exists = Object.prototype.hasOwnProperty.call(current, key);
    const prior = expected[key]!;
    if (exists !== prior.exists || (exists && JSON.stringify(current[key]) !== JSON.stringify(prior.value))) {
      conflicts.push(key);
    }
  }
  return { conflicts };
}

/** Construct preconditions for an internal, named-fields configuration edit.
 * The caller must pass the same admin-safe projection that is used inside
 * saveSettings when it compares the current authoritative state.
 */
export function expectedServerConfigFields(
  observed: Record<string, unknown>,
  changed: Record<string, unknown>,
): Record<string, ServerConfigExpectedField> {
  const expected: Record<string, ServerConfigExpectedField> = Object.create(null);
  for (const key of Object.keys(changed)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") throw new Error("Unsafe setting key.");
    const exists = Object.prototype.hasOwnProperty.call(observed, key);
    expected[key] = exists ? { exists: true, value: observed[key] } : { exists: false };
  }
  return expected;
}
