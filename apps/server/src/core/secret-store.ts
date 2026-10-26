import { clusterSecretFingerprint } from "./crypto-service.js";

export const MASKED_SECRET_VALUE = "********";

export type SecretDescriptor = {
  configured: boolean;
  maskedValue: string;
  fingerprint: string | null;
};

export function describeSecret(value: string | null | undefined, purpose = "secret"): SecretDescriptor {
  const normalized = String(value || "");
  if (!normalized) return { configured: false, maskedValue: "", fingerprint: null };
  return {
    configured: true,
    maskedValue: MASKED_SECRET_VALUE,
    fingerprint: clusterSecretFingerprint(normalized, purpose),
  };
}

export function storedHashFingerprint(hash: string | null | undefined, purpose = "token") {
  const normalized = String(hash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{32,256}$/.test(normalized)) return null;
  return `sha256:${normalized.slice(0, 16)}`;
}

export function secretInputKeepsExisting(value: unknown) {
  return value === undefined || value === null || String(value) === MASKED_SECRET_VALUE;
}
