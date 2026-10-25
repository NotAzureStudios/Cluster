import { hashCredential, verifyCredential } from "./credential-security.js";

export const SECURITY_PIN_FAILURE_LIMIT = 5;
export const SECURITY_PIN_LOCK_MS = 10 * 60 * 1000;

export function normalizeSecurityPin(value: unknown) {
  const pin = String(value || "").trim();
  if (!/^\d{4,8}$/.test(pin)) throw new Error("Enter your 4–8 digit PIN.");
  return pin;
}

export async function hashSecurityPin(pin: unknown) {
  return hashCredential(normalizeSecurityPin(pin));
}

export async function verifySecurityPinCredential(input: {
  prisma: any;
  userId: string;
  pin: unknown;
  purpose: string;
  request?: any;
  logSecurityEvent: (event: any) => Promise<unknown>;
}) {
  const fresh = await input.prisma.user.findUnique({ where: { id: input.userId } });
  if (!fresh?.pinHash) throw new Error("Set a security PIN in Account Settings before using this action.");
  if (fresh.pinLockedUntil && new Date(fresh.pinLockedUntil).getTime() > Date.now()) {
    throw new Error("PIN entry is temporarily locked. Try again later.");
  }

  const pin = normalizeSecurityPin(input.pin);
  const result = await verifyCredential(fresh.pinHash, pin);
  if (!result.valid) {
    const failedPinCount = Number(fresh.failedPinCount || 0) + 1;
    const locked = failedPinCount >= SECURITY_PIN_FAILURE_LIMIT;
    await input.prisma.user.update({
      where: { id: fresh.id },
      data: {
        failedPinCount: locked ? 0 : failedPinCount,
        pinLockedUntil: locked ? new Date(Date.now() + SECURITY_PIN_LOCK_MS) : null,
      },
    });
    await input.logSecurityEvent({
      event: "account.pin_failed",
      actorUserId: fresh.id,
      targetUserId: fresh.id,
      result: "FAILURE",
      reasonCode: locked ? "PIN_LOCKED" : "INVALID_PIN",
      request: input.request,
      metadata: { purpose: input.purpose },
    });
    throw new Error(locked ? "Too many incorrect PIN attempts. PIN entry is locked for 10 minutes." : "Incorrect PIN.");
  }

  await input.prisma.user.update({
    where: { id: fresh.id },
    data: {
      failedPinCount: 0,
      pinLockedUntil: null,
      ...(result.rehash ? { pinHash: result.rehash, pinUpdatedAt: new Date() } : {}),
    },
  });
  await input.logSecurityEvent({
    event: "account.pin_verified",
    actorUserId: fresh.id,
    targetUserId: fresh.id,
    result: "SUCCESS",
    reasonCode: result.rehash ? "PIN_VERIFIED_REHASHED" : "PIN_VERIFIED",
    request: input.request,
    metadata: { purpose: input.purpose, credentialRehashed: Boolean(result.rehash) },
  });
  return true;
}
