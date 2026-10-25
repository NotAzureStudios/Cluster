import crypto from "node:crypto";
import { Algorithm, hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

export const CREDENTIAL_POLICY_VERSION = 1;
export const ARGON2_MEMORY_COST_KIB = 65_536;
export const ARGON2_TIME_COST = 3;
export const ARGON2_PARALLELISM = 1;
export const ARGON2_OUTPUT_LENGTH = 32;

const CLUSTER_SCRYPT_PREFIX = "$cluster-scrypt$v1$";
const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const SCRYPT_KEY_LENGTH = 32;

type ClusterScryptOptions = { N: number; r: number; p: number; maxmem: number };

export type CredentialHashMetadata = {
  algorithm: "argon2id" | "cluster-scrypt" | "unknown";
  version: number;
  memoryCostKiB: number | null;
  timeCost: number | null;
  parallelism: number | null;
  outputLength: number | null;
  requiresRehash: boolean;
};

function scryptAsync(secret: string, salt: Buffer, keyLength: number, options: ClusterScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(secret, salt, keyLength, options, (error, derivedKey) => error ? reject(error) : resolve(derivedKey));
  });
}

async function hashWithScrypt(secret: string) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(secret, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELISM, maxmem: 128 * 1024 * 1024,
  });
  return ["", "cluster-scrypt", "v1", String(SCRYPT_COST), String(SCRYPT_BLOCK_SIZE), String(SCRYPT_PARALLELISM), salt.toString("base64url"), derived.toString("base64url")].join("$");
}

async function verifyScrypt(hash: string, secret: string) {
  const parts = hash.split("$");
  if (parts.length !== 8 || parts[1] !== "cluster-scrypt" || parts[2] !== "v1") return false;
  const N = Number(parts[3]); const r = Number(parts[4]); const p = Number(parts[5]);
  const salt = Buffer.from(parts[6], "base64url"); const expected = Buffer.from(parts[7], "base64url");
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || salt.length < 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
  const actual = await scryptAsync(secret, salt, expected.length, { N, r, p, maxmem: 128 * 1024 * 1024 });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function credentialHashMetadata(hash: string | null | undefined): CredentialHashMetadata {
  const value = String(hash || "");
  if (value.startsWith("$argon2id$")) {
    const params = value.match(/\$m=(\d+),t=(\d+),p=(\d+)\$/);
    const memoryCostKiB = params ? Number(params[1]) : null;
    const timeCost = params ? Number(params[2]) : null;
    const parallelism = params ? Number(params[3]) : null;
    const requiresRehash = memoryCostKiB !== ARGON2_MEMORY_COST_KIB || timeCost !== ARGON2_TIME_COST || parallelism !== ARGON2_PARALLELISM;
    return { algorithm: "argon2id", version: CREDENTIAL_POLICY_VERSION, memoryCostKiB, timeCost, parallelism, outputLength: ARGON2_OUTPUT_LENGTH, requiresRehash };
  }
  if (value.startsWith(CLUSTER_SCRYPT_PREFIX)) {
    return { algorithm: "cluster-scrypt", version: 1, memoryCostKiB: null, timeCost: null, parallelism: null, outputLength: SCRYPT_KEY_LENGTH, requiresRehash: true };
  }
  return { algorithm: "unknown", version: 0, memoryCostKiB: null, timeCost: null, parallelism: null, outputLength: null, requiresRehash: true };
}

export async function hashCredential(secret: string) {
  try {
    return await argon2Hash(secret, {
      algorithm: Algorithm.Argon2id,
      memoryCost: ARGON2_MEMORY_COST_KIB,
      timeCost: ARGON2_TIME_COST,
      parallelism: ARGON2_PARALLELISM,
      outputLen: ARGON2_OUTPUT_LENGTH,
    });
  } catch {
    // Keep recovery possible on hosts where the native Argon2 module cannot initialize.
    // The fallback is deliberately marked for rehash so Argon2id is restored later.
    return hashWithScrypt(secret);
  }
}

export async function verifyCredential(hash: string, secret: string) {
  try {
    const valid = hash.startsWith(CLUSTER_SCRYPT_PREFIX) ? await verifyScrypt(hash, secret) : await argon2Verify(hash, secret);
    return { valid, metadata: credentialHashMetadata(hash), rehash: valid && credentialHashMetadata(hash).requiresRehash ? await hashCredential(secret) : null };
  } catch {
    return { valid: false, metadata: credentialHashMetadata(hash), rehash: null };
  }
}
