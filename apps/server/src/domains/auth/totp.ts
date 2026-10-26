import crypto from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(input: Buffer) {
  let bits = "";
  for (const byte of input) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let offset = 0; offset < bits.length; offset += 5) {
    const chunk = bits.slice(offset, offset + 5).padEnd(5, "0");
    output += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }
  return output;
}

export function decodeBase32(value: string) {
  const normalized = String(value || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 value.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

export function generateTotpSecret(bytes = 20) {
  return encodeBase32(crypto.randomBytes(Math.max(20, Math.min(64, bytes))));
}

export function totpCode(secret: string, timestampMs = Date.now(), stepSeconds = 30, digits = 6) {
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

function timingSafeTextEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyTotp(secret: string, supplied: string, timestampMs = Date.now(), window = 1) {
  const clean = String(supplied || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  for (let drift = -Math.max(0, window); drift <= Math.max(0, window); drift += 1) {
    if (timingSafeTextEqual(totpCode(secret, timestampMs + drift * 30_000), clean)) return true;
  }
  return false;
}

export function totpEnrollmentUri(input: { secret: string; accountName: string; issuer?: string }) {
  const issuer = String(input.issuer || "Cluster").trim().slice(0, 80) || "Cluster";
  const account = String(input.accountName || "account").trim().slice(0, 160) || "account";
  const label = `${issuer}:${account}`;
  const query = new URLSearchParams({ secret: input.secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: Math.max(6, Math.min(20, count)) }, () => {
    const raw = crypto.randomBytes(10).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
  });
}
