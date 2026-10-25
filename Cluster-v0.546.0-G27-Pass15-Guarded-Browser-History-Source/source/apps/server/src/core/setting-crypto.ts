import {
  clusterEncryptedValueNeedsRotation,
  clusterEncryptionKeyConfigured,
  clusterEncryptionKeyId,
  decryptClusterValue,
  encryptClusterValue,
  isClusterEncryptedValue,
  previousClusterEncryptionKeyIds,
  signClusterPayload,
  validateClusterCryptoConfiguration,
  verifyClusterPayload,
} from "./crypto-service.js";

export const SENSITIVE_SETTING_KEYS = new Set(["discordWebhookUrl", "discordBotToken"]);
export const BOOT_SECRET_SETTING_KEYS = new Set(["databaseUrlOverride", "redisUrlOverride"]);
export const ALL_SECRET_SETTING_KEYS = new Set([...SENSITIVE_SETTING_KEYS, ...BOOT_SECRET_SETTING_KEYS]);

export function validateSecretEncryptionConfiguration(input: {
  nodeEnv: string;
  env?: NodeJS.ProcessEnv;
  sessionSecret?: string;
  authSecret?: string;
}) {
  return validateClusterCryptoConfiguration(input);
}

export function signWithClusterSecret(purpose: string, payload: string | Buffer, env: NodeJS.ProcessEnv = process.env) {
  return signClusterPayload(purpose, payload, env);
}

export function verifyClusterSecretSignature(
  purpose: string,
  payload: string | Buffer,
  signature: { algorithm?: string; keyId?: string; digest?: string } | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
) {
  return verifyClusterPayload(purpose, payload, signature, env);
}

export function encryptionKeyConfigured(env: NodeJS.ProcessEnv = process.env) {
  return clusterEncryptionKeyConfigured(env);
}

export function encryptionKeyId(env: NodeJS.ProcessEnv = process.env) {
  return clusterEncryptionKeyId(env);
}

export function previousEncryptionKeyIds(env: NodeJS.ProcessEnv = process.env) {
  return previousClusterEncryptionKeyIds(env);
}

export function isEncryptedValue(value: string | undefined | null) {
  return isClusterEncryptedValue(value);
}

export function encryptedValueNeedsRotation(value: string | undefined | null, env: NodeJS.ProcessEnv = process.env) {
  return clusterEncryptedValueNeedsRotation(value, env);
}

export function shouldEncryptSetting(key: string) {
  return SENSITIVE_SETTING_KEYS.has(key);
}

export function encryptSettingStorageValue(key: string, rawJsonValue: string, env: NodeJS.ProcessEnv = process.env) {
  return shouldEncryptSetting(key) ? encryptClusterValue(`setting:${key}`, rawJsonValue, env) : rawJsonValue;
}

export function decryptSettingStorageValue(key: string, storedValue: string, env: NodeJS.ProcessEnv = process.env) {
  return shouldEncryptSetting(key) ? decryptClusterValue(`setting:${key}`, storedValue, env) : storedValue;
}

export function encryptBootSettingStorageValue(key: string, rawJsonValue: string, env: NodeJS.ProcessEnv = process.env) {
  return BOOT_SECRET_SETTING_KEYS.has(key) ? encryptClusterValue(`boot-setting:${key}`, rawJsonValue, env) : rawJsonValue;
}

export function decryptBootSettingStorageValue(key: string, storedValue: string, env: NodeJS.ProcessEnv = process.env) {
  return BOOT_SECRET_SETTING_KEYS.has(key) ? decryptClusterValue(`boot-setting:${key}`, storedValue, env) : storedValue;
}

export function encryptContextPackStorageValue(rawJsonValue: string, env: NodeJS.ProcessEnv = process.env) {
  return encryptClusterValue("context-pack:payload", rawJsonValue, env);
}

export function decryptContextPackStorageValue(storedValue: string, env: NodeJS.ProcessEnv = process.env) {
  return decryptClusterValue("context-pack:payload", storedValue, env);
}

export function encryptSecuritySecret(purpose: string, rawValue: string, env: NodeJS.ProcessEnv = process.env) {
  const cleanPurpose = String(purpose || "generic").trim().slice(0, 120) || "generic";
  return encryptClusterValue(`security-secret:${cleanPurpose}`, String(rawValue || ""), env);
}

export function decryptSecuritySecret(purpose: string, storedValue: string, env: NodeJS.ProcessEnv = process.env) {
  const cleanPurpose = String(purpose || "generic").trim().slice(0, 120) || "generic";
  return decryptClusterValue(`security-secret:${cleanPurpose}`, String(storedValue || ""), env);
}
