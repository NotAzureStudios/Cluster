import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import { requestDeviceId, requestDevicePlatform } from "./session-device.js";

const DEVICE_PROOF_VERSION = "cluster-device-proof-v1";
const DEVICE_PROOF_ALGORITHM = "ES256";
const DEVICE_PROOF_MAX_SKEW_MS = 2 * 60 * 1000;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type DeviceProofResult = {
  present: boolean;
  verified: boolean;
  code: "missing" | "verified" | "invalid" | "stale" | "device_mismatch" | "key_mismatch" | "revoked" | "unsupported";
  deviceId: string | null;
  keyFingerprint: string | null;
  verifiedAt: Date | null;
};

function headerValue(request: FastifyRequest, name: string) {
  const raw = request.headers[name];
  return String(Array.isArray(raw) ? raw[0] : raw || "").trim();
}

function canonicalRequestProof(input: { deviceId: string; method: string; path: string; requestId: string; timestamp: string }) {
  return [DEVICE_PROOF_VERSION, input.deviceId, input.method.toUpperCase(), input.path, input.requestId, input.timestamp].join("\n");
}

function decodeBase64Url(value: string, maxBytes: number) {
  if (!value || !BASE64URL_PATTERN.test(value) || value.length > Math.ceil(maxBytes * 4 / 3) + 8) return null;
  try {
    const buffer = Buffer.from(value, "base64url");
    return buffer.length > 0 && buffer.length <= maxBytes ? buffer : null;
  } catch {
    return null;
  }
}

function publicKeyInfo(spki: Buffer) {
  try {
    const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ec") return null;
    const details = key.asymmetricKeyDetails as { namedCurve?: string } | undefined;
    if (!details || !["prime256v1", "P-256"].includes(String(details.namedCurve || ""))) return null;
    return key;
  } catch {
    return null;
  }
}

export function deviceProofKeyFingerprint(spki: Buffer | string) {
  const bytes = typeof spki === "string" ? Buffer.from(spki, "base64url") : spki;
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("base64url").slice(0, 32)}`;
}

export function verifyPresentedDeviceKey(input: { publicKeySpki: string; signature: string; message: string }) {
  const spki = decodeBase64Url(input.publicKeySpki, 512);
  const signature = decodeBase64Url(input.signature, 128);
  if (!spki || !signature || signature.length !== 64) return { ok: false as const, code: "DEVICE_PROOF_INVALID" };
  const key = publicKeyInfo(spki);
  if (!key) return { ok: false as const, code: "DEVICE_PROOF_UNSUPPORTED_KEY" };
  const valid = crypto.verify("sha256", Buffer.from(input.message, "utf8"), { key, dsaEncoding: "ieee-p1363" }, signature);
  if (!valid) return { ok: false as const, code: "DEVICE_PROOF_INVALID" };
  return { ok: true as const, spki, fingerprint: deviceProofKeyFingerprint(spki), algorithm: DEVICE_PROOF_ALGORITHM };
}

export function deviceProofRotationMessage(input: { deviceId: string; timestamp: string }) {
  return ["cluster-device-proof-rotate-v1", input.deviceId, input.timestamp].join("\n");
}

export async function verifyDeviceProofForRequest(prisma: any, request: FastifyRequest, session: any): Promise<DeviceProofResult> {
  const deviceId = requestDeviceId(request);
  const timestamp = headerValue(request, "x-cluster-device-proof-timestamp");
  const requestId = headerValue(request, "x-client-request-id") || String(request.id || "");
  const signatureValue = headerValue(request, "x-cluster-device-proof-signature");
  const publicKeySpki = headerValue(request, "x-cluster-device-proof-public-key");
  const algorithm = headerValue(request, "x-cluster-device-proof-algorithm");
  const proofPresent = Boolean(timestamp || signatureValue || publicKeySpki || algorithm);
  const missing: DeviceProofResult = { present: proofPresent, verified: false, code: "missing", deviceId, keyFingerprint: null, verifiedAt: null };
  if (!proofPresent) return missing;
  if (!deviceId || !timestamp || !signatureValue || !publicKeySpki || !requestId) return { ...missing, code: "invalid" };
  if (algorithm !== DEVICE_PROOF_ALGORITHM) return { ...missing, code: "unsupported" };
  if (session.deviceId && String(session.deviceId) !== deviceId) return { ...missing, code: "device_mismatch" };
  const timestampMs = Number(timestamp);
  if (!Number.isSafeInteger(timestampMs) || Math.abs(Date.now() - timestampMs) > DEVICE_PROOF_MAX_SKEW_MS) return { ...missing, code: "stale" };

  const verifiedKey = verifyPresentedDeviceKey({
    publicKeySpki,
    signature: signatureValue,
    message: canonicalRequestProof({ deviceId, method: request.method, path: request.url, requestId, timestamp }),
  });
  if (!verifiedKey.ok) return { ...missing, code: verifiedKey.code === "DEVICE_PROOF_UNSUPPORTED_KEY" ? "unsupported" : "invalid" };

  const now = new Date();
  const existing = await prisma.deviceRegistration.findUnique({ where: { userId_deviceId: { userId: session.userId, deviceId } } }).catch(() => null);
  if (existing?.proofKeyFingerprint && String(existing.proofKeyFingerprint) !== verifiedKey.fingerprint) {
    return { present: true, verified: false, code: "key_mismatch", deviceId, keyFingerprint: verifiedKey.fingerprint, verifiedAt: null };
  }
  if (existing?.revokedAt && new Date(session.createdAt).getTime() <= new Date(existing.revokedAt).getTime()) {
    return { present: true, verified: false, code: "revoked", deviceId, keyFingerprint: verifiedKey.fingerprint, verifiedAt: null };
  }

  const platform = requestDevicePlatform(request);
  const userAgent = String(request.headers["user-agent"] || "Unknown client").slice(0, 500);
  const updateProofSeen = !existing?.proofLastSeenAt || now.getTime() - new Date(existing.proofLastSeenAt).getTime() > 5 * 60 * 1000;
  const device = existing
    ? await prisma.deviceRegistration.update({
        where: { id: existing.id },
        data: {
          proofStatus: "verified",
          proofAlgorithm: DEVICE_PROOF_ALGORITHM,
          proofPublicKeySpki: publicKeySpki,
          proofKeyFingerprint: verifiedKey.fingerprint,
          proofVerifiedAt: existing.proofVerifiedAt || now,
          ...(updateProofSeen ? { proofLastSeenAt: now, lastSeenAt: now, platform: platform || existing.platform, userAgent } : {}),
          ...(existing.revokedAt ? { revokedAt: null } : {}),
        },
      })
    : await prisma.deviceRegistration.create({
        data: {
          userId: session.userId,
          deviceId,
          platform,
          userAgent,
          firstSeenAt: now,
          lastSeenAt: now,
          proofStatus: "verified",
          proofAlgorithm: DEVICE_PROOF_ALGORITHM,
          proofPublicKeySpki: publicKeySpki,
          proofKeyFingerprint: verifiedKey.fingerprint,
          proofVerifiedAt: now,
          proofLastSeenAt: now,
        },
      });

  return {
    present: true,
    verified: true,
    code: "verified",
    deviceId,
    keyFingerprint: verifiedKey.fingerprint,
    verifiedAt: device.proofVerifiedAt || now,
  };
}

export function requestDeviceProof(request: FastifyRequest): DeviceProofResult | null {
  return (request as FastifyRequest & { clusterDeviceProof?: DeviceProofResult }).clusterDeviceProof || null;
}

export function setRequestDeviceProof(request: FastifyRequest, proof: DeviceProofResult) {
  (request as FastifyRequest & { clusterDeviceProof?: DeviceProofResult }).clusterDeviceProof = proof;
}
