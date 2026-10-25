/** Bounded, administrator-configurable intervals for existing Cluster maintenance loops.
 * The database is authoritative; missing/invalid legacy values fall back to safe defaults.
 * These are check cadences, not authority for automatic restarts, upgrades, or destructive repairs.
 */
export const OPERATIONS_CADENCE = {
  operationsReadinessIntervalMinutes: { defaultValue: 2, min: 2, max: 15 },
  operationsEscalationIntervalMinutes: { defaultValue: 2, min: 2, max: 5 },
  operationsNativeReconcileIntervalMinutes: { defaultValue: 2, min: 2, max: 5 },
  operationsIntegrityScanHours: { defaultValue: 6, min: 1, max: 24 },
} as const;

export type OperationsCadenceKey = keyof typeof OPERATIONS_CADENCE;

export function operationsCadenceMilliseconds(key: OperationsCadenceKey, raw: unknown): number {
  const rule = OPERATIONS_CADENCE[key];
  const value = typeof raw === "number" && Number.isSafeInteger(raw) && raw >= rule.min && raw <= rule.max
    ? raw : rule.defaultValue;
  return value * (key === "operationsIntegrityScanHours" ? 3_600_000 : 60_000);
}

export function operationsCadenceValue(key: OperationsCadenceKey, raw: unknown): number {
  return operationsCadenceMilliseconds(key, raw) / (key === "operationsIntegrityScanHours" ? 3_600_000 : 60_000);
}
