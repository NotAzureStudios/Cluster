import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, open, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const ENCRYPTION_PREFIX = "enc:v2:";
const KEY_ID_HEX_LENGTH = 16;
const MIN_SECRET_BYTES = 32;

function normalizeSecret(value: unknown) {
  return String(value || "").trim();
}

function byteLength(value: string) {
  return Buffer.byteLength(value, "utf8");
}

function splitPreviousSecrets(env: NodeJS.ProcessEnv) {
  return String(env.CLUSTER_SECRET_KEY_PREVIOUS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function keyId(secret: string) {
  return crypto.createHash("sha256").update(`cluster-secret-id:v2:${secret}`).digest("hex").slice(0, KEY_ID_HEX_LENGTH);
}

function currentSecret(env: NodeJS.ProcessEnv = process.env) {
  const configured = normalizeSecret(env.CLUSTER_SECRET_KEY);
  if (byteLength(configured) >= MIN_SECRET_BYTES) return configured;
  if (String(env.NODE_ENV || "").toLowerCase() === "production") {
    throw new Error("Production requires CLUSTER_SECRET_KEY with at least 32 bytes before encrypting protected Cluster data.");
  }
  const developmentFallback = normalizeSecret(env.SESSION_SECRET) || "local-cluster-secret";
  return developmentFallback;
}

function secretCandidates(env: NodeJS.ProcessEnv = process.env) {
  const candidates: string[] = [];
  const add = (value: unknown) => {
    const secret = normalizeSecret(value);
    if (!secret || candidates.includes(secret)) return;
    candidates.push(secret);
  };
  add(currentSecret(env));
  for (const previous of splitPreviousSecrets(env)) add(previous);
  return candidates;
}

function purposeKey(secret: string, purpose: string) {
  return Buffer.from(crypto.hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.from("cluster-purpose-key-v1", "utf8"),
    Buffer.from(purpose, "utf8"),
    32,
  ));
}

function storageKey(secret: string) {
  return Buffer.from(crypto.hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.from("cluster-storage-v2", "utf8"),
    Buffer.from("authenticated-settings-and-context-packs", "utf8"),
    32,
  ));
}

export function validateClusterCryptoConfiguration(input: {
  nodeEnv: string;
  env?: NodeJS.ProcessEnv;
  sessionSecret?: string;
  authSecret?: string;
}) {
  const env = input.env ?? process.env;
  const current = normalizeSecret(env.CLUSTER_SECRET_KEY);
  const production = String(input.nodeEnv || "").toLowerCase() === "production";
  if (production && byteLength(current) < MIN_SECRET_BYTES) {
    throw new Error("Production requires CLUSTER_SECRET_KEY with at least 32 bytes for encrypted settings and protected secrets.");
  }
  if (current && byteLength(current) < MIN_SECRET_BYTES) throw new Error("CLUSTER_SECRET_KEY must contain at least 32 bytes when configured.");
  if (current && input.sessionSecret && current === input.sessionSecret) throw new Error("CLUSTER_SECRET_KEY must be distinct from SESSION_SECRET.");
  if (current && input.authSecret && current === input.authSecret) throw new Error("CLUSTER_SECRET_KEY must be distinct from CLUSTER_AUTH_SECRET.");
  for (const previous of splitPreviousSecrets(env)) {
    if (byteLength(previous) < MIN_SECRET_BYTES) throw new Error("Every CLUSTER_SECRET_KEY_PREVIOUS entry must contain at least 32 bytes.");
    if (previous === current) throw new Error("CLUSTER_SECRET_KEY_PREVIOUS must not repeat the active CLUSTER_SECRET_KEY.");
  }
}

export function clusterEncryptionKeyConfigured(env: NodeJS.ProcessEnv = process.env) {
  return byteLength(normalizeSecret(env.CLUSTER_SECRET_KEY)) >= MIN_SECRET_BYTES;
}

export function clusterEncryptionKeyId(env: NodeJS.ProcessEnv = process.env) {
  return clusterEncryptionKeyConfigured(env) ? keyId(normalizeSecret(env.CLUSTER_SECRET_KEY)) : null;
}

export function previousClusterEncryptionKeyIds(env: NodeJS.ProcessEnv = process.env) {
  return splitPreviousSecrets(env).filter((secret) => byteLength(secret) >= MIN_SECRET_BYTES).map(keyId);
}

export function isClusterEncryptedValue(value: string | undefined | null) {
  return Boolean(value && value.startsWith(ENCRYPTION_PREFIX));
}

export function clusterEncryptedValueNeedsRotation(value: string | undefined | null, env: NodeJS.ProcessEnv = process.env) {
  if (!value || !isClusterEncryptedValue(value)) return true;
  const storedKeyId = value.slice(ENCRYPTION_PREFIX.length).split(":", 1)[0];
  return storedKeyId !== keyId(currentSecret(env));
}

export function encryptClusterValue(purpose: string, raw: string, env: NodeJS.ProcessEnv = process.env) {
  if (!raw || raw.startsWith(ENCRYPTION_PREFIX)) return raw;
  const secret = currentSecret(env);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", storageKey(secret), iv);
  cipher.setAAD(Buffer.from(purpose, "utf8"));
  const encrypted = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${keyId(secret)}:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptClusterValue(purpose: string, value: string, env: NodeJS.ProcessEnv = process.env) {
  if (!value || !value.startsWith(ENCRYPTION_PREFIX)) return value;
  const parts = value.slice(ENCRYPTION_PREFIX.length).split(":");
  if (parts.length !== 4) throw new Error(`Encrypted value for ${purpose} is malformed.`);
  const [storedKeyId, ivValue, tagValue, encryptedValue] = parts;
  const secret = secretCandidates(env).find((candidate) => keyId(candidate) === storedKeyId);
  if (!secret) throw new Error(`Encrypted value for ${purpose} requires unavailable Cluster secret key ${storedKeyId}.`);
  const decipher = crypto.createDecipheriv("aes-256-gcm", storageKey(secret), Buffer.from(ivValue, "base64url"));
  decipher.setAAD(Buffer.from(purpose, "utf8"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

export function signClusterPayload(purpose: string, payload: string | Buffer, env: NodeJS.ProcessEnv = process.env) {
  const secret = currentSecret(env);
  return {
    algorithm: "hmac-sha256" as const,
    keyId: keyId(secret),
    digest: crypto.createHmac("sha256", purposeKey(secret, purpose)).update(payload).digest("base64url"),
  };
}

export function verifyClusterPayload(
  purpose: string,
  payload: string | Buffer,
  signature: { algorithm?: string; keyId?: string; digest?: string } | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (signature?.algorithm !== "hmac-sha256" || !signature.keyId || !signature.digest) return false;
  const secret = secretCandidates(env).find((candidate) => keyId(candidate) === signature.keyId);
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", purposeKey(secret, purpose)).update(payload).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature.digest, "base64url"); } catch { return false; }
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

export function clusterSecretFingerprint(value: string | Buffer, purpose = "secret") {
  const digest = crypto.createHash("sha256").update(`cluster-secret-fingerprint:v1:${purpose}:`).update(value).digest("hex");
  return `sha256:${digest.slice(0, 16)}`;
}

export function randomClusterSecret(bytes = 32) {
  return crypto.randomBytes(Math.max(16, Math.min(128, Math.trunc(bytes)))).toString("base64url");
}

export function constantTimeTextEqual(a: unknown, b: unknown) {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}


const FILE_ENCRYPTION_MAGIC = "CLUSTER-ENC-FILE-V1";

type ClusterEncryptedFileHeader = {
  format: "cluster-aes256gcm-file-v1";
  keyId: string;
  iv: string;
  purpose: string;
};

export async function encryptClusterFile(purpose: string, inputPath: string, outputPath: string, env: NodeJS.ProcessEnv = process.env) {
  const secret = currentSecret(env);
  const iv = crypto.randomBytes(12);
  const header: ClusterEncryptedFileHeader = { format: "cluster-aes256gcm-file-v1", keyId: keyId(secret), iv: iv.toString("base64url"), purpose };
  const headerLine = `${FILE_ENCRYPTION_MAGIC} ${Buffer.from(JSON.stringify(header), "utf8").toString("base64url")}\n`;
  const cipher = crypto.createCipheriv("aes-256-gcm", storageKey(secret), iv);
  cipher.setAAD(Buffer.from(purpose, "utf8"));
  await writeFile(outputPath, headerLine, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await pipeline(createReadStream(inputPath), cipher, createWriteStream(outputPath, { flags: "a", mode: 0o600 }));
    const tag = cipher.getAuthTag();
    await appendFile(outputPath, tag);
    return { format: header.format, keyId: header.keyId, purpose, headerBytes: Buffer.byteLength(headerLine), tagBytes: tag.length };
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function decryptClusterFile(purpose: string, inputPath: string, outputPath: string, env: NodeJS.ProcessEnv = process.env) {
  const handle = await open(inputPath, "r");
  try {
    const prefix = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
    const view = prefix.subarray(0, bytesRead);
    const newline = view.indexOf(0x0a);
    if (newline < 0) throw new Error(`Encrypted file for ${purpose} has no valid header.`);
    const line = view.subarray(0, newline).toString("utf8");
    if (!line.startsWith(`${FILE_ENCRYPTION_MAGIC} `)) throw new Error(`Encrypted file for ${purpose} uses an unsupported format.`);
    let header: ClusterEncryptedFileHeader;
    try { header = JSON.parse(Buffer.from(line.slice(FILE_ENCRYPTION_MAGIC.length + 1), "base64url").toString("utf8")); }
    catch { throw new Error(`Encrypted file for ${purpose} has a malformed header.`); }
    if (header.format !== "cluster-aes256gcm-file-v1" || header.purpose !== purpose) throw new Error(`Encrypted file purpose mismatch for ${purpose}.`);
    const secret = secretCandidates(env).find((candidate) => keyId(candidate) === header.keyId);
    if (!secret) throw new Error(`Encrypted file for ${purpose} requires unavailable Cluster secret key ${header.keyId}.`);
    const info = await stat(inputPath);
    const headerBytes = newline + 1;
    if (info.size <= headerBytes + 16) throw new Error(`Encrypted file for ${purpose} is truncated.`);
    const tag = Buffer.alloc(16);
    await handle.read(tag, 0, tag.length, info.size - tag.length);
    const decipher = crypto.createDecipheriv("aes-256-gcm", storageKey(secret), Buffer.from(header.iv, "base64url"));
    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(tag);
    try {
      await pipeline(
        createReadStream(inputPath, { start: headerBytes, end: info.size - tag.length - 1 }),
        decipher,
        createWriteStream(outputPath, { flags: "wx", mode: 0o600 }),
      );
    } catch (error) {
      await rm(outputPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return { format: header.format, keyId: header.keyId, purpose, plaintextBytes: (await stat(outputPath)).size };
  } finally {
    await handle.close();
  }
}
