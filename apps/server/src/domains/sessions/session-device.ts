import type { FastifyRequest } from "fastify";

const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestDeviceId(request?: FastifyRequest | null) {
  if (!request) return null;
  const raw = request.headers["x-cluster-device-id"];
  const value = String(Array.isArray(raw) ? raw[0] : raw || "").trim();
  return DEVICE_ID_PATTERN.test(value) ? value.toLowerCase() : null;
}

export function requestDevicePlatform(request?: FastifyRequest | null) {
  if (!request) return null;
  const hostRaw = request.headers["x-cluster-client-host"];
  const host = String(Array.isArray(hostRaw) ? hostRaw[0] : hostRaw || "").trim().toLowerCase();
  if (["desktop", "web"].includes(host)) return host;
  return null;
}

export function defaultDeviceLabel(input: { platform?: string | null; userAgent?: string | null }) {
  const ua = String(input.userAgent || "");
  const platform = String(input.platform || "").toLowerCase();
  if (platform === "desktop") {
    if (/windows/i.test(ua)) return "Windows desktop";
    if (/macintosh|mac os/i.test(ua)) return "Mac desktop";
    if (/linux/i.test(ua)) return "Linux desktop";
    return "Cluster desktop";
  }
  if (/iphone/i.test(ua)) return "iPhone browser";
  if (/ipad/i.test(ua)) return "iPad browser";
  if (/android/i.test(ua)) return "Android browser";
  if (/edg\//i.test(ua)) return "Edge browser";
  if (/firefox\//i.test(ua)) return "Firefox browser";
  if (/chrome\//i.test(ua)) return "Chrome browser";
  if (/safari\//i.test(ua)) return "Safari browser";
  return platform === "web" ? "Web browser" : "Unknown device";
}

export async function touchDeviceRegistration(prisma: any, input: {
  userId: string;
  deviceId: string | null;
  platform?: string | null;
  userAgent?: string | null;
}) {
  if (!input.deviceId) return null;
  const now = new Date();
  const userAgent = String(input.userAgent || "Unknown client").slice(0, 500);
  const platform = String(input.platform || "").slice(0, 32) || null;
  return prisma.deviceRegistration.upsert({
    where: { userId_deviceId: { userId: input.userId, deviceId: input.deviceId } },
    create: {
      userId: input.userId,
      deviceId: input.deviceId,
      platform,
      userAgent,
      firstSeenAt: now,
      lastSeenAt: now,
      revokedAt: null,
    },
    update: {
      platform,
      userAgent,
      lastSeenAt: now,
    },
  }).catch(() => null);
}

export function serializeDeviceRecord(device: any, sessions: any[] = [], currentSessionId?: string | null) {
  const activeSessions = sessions.filter((session) => !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now());
  const current = activeSessions.some((session) => currentSessionId && session.id === currentSessionId);
  const latest = activeSessions.slice().sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())[0];
  return {
    id: device.id,
    deviceId: device.deviceId,
    label: device.label || defaultDeviceLabel({ platform: device.platform, userAgent: latest?.userAgent || device.userAgent }),
    customLabel: device.label || null,
    platform: device.platform || null,
    userAgent: latest?.userAgent || device.userAgent || "Unknown client",
    firstSeenAt: device.firstSeenAt,
    lastSeenAt: latest?.lastSeenAt || device.lastSeenAt,
    revokedAt: device.revokedAt || null,
    activeSessionCount: activeSessions.length,
    current,
    sessionIds: activeSessions.map((session) => session.id),
    proofStatus: device.proofStatus || "unverified",
    proofAlgorithm: device.proofAlgorithm || null,
    proofKeyFingerprint: device.proofKeyFingerprint || null,
    proofVerifiedAt: device.proofVerifiedAt || null,
    proofLastSeenAt: device.proofLastSeenAt || null,
    cryptographicallyBound: device.proofStatus === "verified" && Boolean(device.proofKeyFingerprint) && !device.revokedAt,
    confidence: device.proofStatus === "verified" && device.proofKeyFingerprint ? "asymmetric-device-proof" : "client-installation-id",
  };
}
