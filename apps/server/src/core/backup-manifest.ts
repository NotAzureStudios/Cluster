import { signWithClusterSecret, verifyClusterSecretSignature } from "./setting-crypto.js";

export type BackupManifestSignature = {
  algorithm: "hmac-sha256";
  keyId: string;
  digest: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === "signature") continue;
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

export function canonicalBackupManifest(manifest: Record<string, unknown>) {
  return JSON.stringify(canonicalize(manifest));
}

export function signBackupManifest<T extends Record<string, unknown>>(manifest: T, env: NodeJS.ProcessEnv = process.env): T & { signature: BackupManifestSignature } {
  const payload = canonicalBackupManifest(manifest);
  const signature = signWithClusterSecret("backup-manifest-v2", payload, env);
  return { ...manifest, signature };
}

export function verifyBackupManifestSignature(manifest: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env) {
  const signature = manifest.signature as BackupManifestSignature | undefined;
  return verifyClusterSecretSignature("backup-manifest-v2", canonicalBackupManifest(manifest), signature, env);
}
