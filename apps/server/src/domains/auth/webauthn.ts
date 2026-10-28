import crypto from "node:crypto";
import { isIP } from "node:net";

function b64url(value: Buffer) { return value.toString("base64url"); }
function fromB64url(value: string) { return Buffer.from(String(value || ""), "base64url"); }
function sha256Buffer(value: Buffer | string) { return crypto.createHash("sha256").update(value).digest(); }
function safeEqual(left: Buffer, right: Buffer) { return left.length === right.length && crypto.timingSafeEqual(left, right); }

class CborReader {
  constructor(private readonly data: Buffer, public offset = 0) {}
  read(): any {
    if (this.offset >= this.data.length) throw new Error("CBOR_TRUNCATED");
    const initial = this.data[this.offset++];
    const major = initial >> 5;
    const info = initial & 31;
    const length = this.readLength(info);
    if (major === 0) return length;
    if (major === 1) return -1 - Number(length);
    if (major === 2) return this.take(Number(length));
    if (major === 3) return this.take(Number(length)).toString("utf8");
    if (major === 4) return Array.from({ length: Number(length) }, () => this.read());
    if (major === 5) {
      const map = new Map<any, any>();
      for (let index = 0; index < Number(length); index += 1) map.set(this.read(), this.read());
      return map;
    }
    if (major === 6) { this.read(); return this.read(); }
    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22 || info === 23) return null;
    }
    throw new Error("CBOR_UNSUPPORTED");
  }
  private readLength(info: number): number | bigint {
    if (info < 24) return info;
    if (info === 24) return this.data[this.offset++];
    if (info === 25) { const value = this.data.readUInt16BE(this.offset); this.offset += 2; return value; }
    if (info === 26) { const value = this.data.readUInt32BE(this.offset); this.offset += 4; return value; }
    if (info === 27) { const value = this.data.readBigUInt64BE(this.offset); this.offset += 8; return value; }
    throw new Error("CBOR_INDEFINITE_UNSUPPORTED");
  }
  private take(length: number) {
    if (length < 0 || this.offset + length > this.data.length) throw new Error("CBOR_TRUNCATED");
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
}

function parseClientData(encoded: string, expectedType: "webauthn.create" | "webauthn.get", expectedChallenge: string, expectedOrigin: string) {
  let client: any;
  try { client = JSON.parse(fromB64url(encoded).toString("utf8")); } catch { throw new Error("WEBAUTHN_CLIENT_DATA_INVALID"); }
  if (client?.type !== expectedType) throw new Error("WEBAUTHN_TYPE_MISMATCH");
  if (String(client?.challenge || "") !== expectedChallenge) throw new Error("WEBAUTHN_CHALLENGE_MISMATCH");
  if (String(client?.origin || "") !== expectedOrigin) throw new Error("WEBAUTHN_ORIGIN_MISMATCH");
  if (client?.crossOrigin === true) throw new Error("WEBAUTHN_CROSS_ORIGIN_BLOCKED");
  return { client, raw: fromB64url(encoded) };
}

function parseAuthenticatorData(authData: Buffer, rpId: string) {
  if (authData.length < 37) throw new Error("WEBAUTHN_AUTH_DATA_INVALID");
  const rpIdHash = authData.subarray(0, 32);
  if (!safeEqual(rpIdHash, sha256Buffer(rpId))) throw new Error("WEBAUTHN_RP_ID_MISMATCH");
  const flags = authData[32];
  if ((flags & 0x01) === 0) throw new Error("WEBAUTHN_USER_PRESENCE_REQUIRED");
  const signCount = BigInt(authData.readUInt32BE(33));
  return {
    flags,
    signCount,
    userPresent: Boolean(flags & 0x01),
    userVerified: Boolean(flags & 0x04),
    backupEligible: Boolean(flags & 0x08),
    backupState: Boolean(flags & 0x10),
    attestedCredentialData: Boolean(flags & 0x40),
  };
}

function coseToSpki(cose: Map<any, any>) {
  const kty = Number(cose.get(1));
  const alg = Number(cose.get(3));
  if (kty === 2 && alg === -7) {
    const crv = Number(cose.get(-1));
    const x = cose.get(-2); const y = cose.get(-3);
    if (crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y)) throw new Error("WEBAUTHN_COSE_KEY_INVALID");
    const key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64url(x), y: b64url(y) }, format: "jwk" });
    return { publicKeySpki: b64url(key.export({ format: "der", type: "spki" })), algorithm: "ES256" };
  }
  if (kty === 1 && alg === -8) {
    const crv = Number(cose.get(-1)); const x = cose.get(-2);
    if (crv !== 6 || !Buffer.isBuffer(x)) throw new Error("WEBAUTHN_COSE_KEY_INVALID");
    const key = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: b64url(x) }, format: "jwk" });
    return { publicKeySpki: b64url(key.export({ format: "der", type: "spki" })), algorithm: "EdDSA" };
  }
  if (kty === 3 && alg === -257) {
    const n = cose.get(-1); const e = cose.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) throw new Error("WEBAUTHN_COSE_KEY_INVALID");
    const key = crypto.createPublicKey({ key: { kty: "RSA", n: b64url(n), e: b64url(e) }, format: "jwk" });
    return { publicKeySpki: b64url(key.export({ format: "der", type: "spki" })), algorithm: "RS256" };
  }
  throw new Error("WEBAUTHN_ALGORITHM_UNSUPPORTED");
}

export type WebAuthnRegistrationCredential = {
  id: string; rawId?: string; type: string; authenticatorAttachment?: string | null;
  clientExtensionResults?: { credProps?: { rk?: boolean } };
  response: { clientDataJSON: string; attestationObject: string; transports?: string[] };
};

export function verifyWebAuthnRegistration(input: { credential: WebAuthnRegistrationCredential; expectedChallenge: string; expectedOrigin: string; rpId: string }) {
  if (input.credential.type !== "public-key") throw new Error("WEBAUTHN_CREDENTIAL_TYPE_INVALID");
  parseClientData(input.credential.response.clientDataJSON, "webauthn.create", input.expectedChallenge, input.expectedOrigin);
  const attestation = new CborReader(fromB64url(input.credential.response.attestationObject)).read();
  if (!(attestation instanceof Map)) throw new Error("WEBAUTHN_ATTESTATION_INVALID");
  const format = String(attestation.get("fmt") || "");
  if (format !== "none") throw new Error("WEBAUTHN_ATTESTATION_FORMAT_UNSUPPORTED");
  const authData = attestation.get("authData");
  if (!Buffer.isBuffer(authData)) throw new Error("WEBAUTHN_AUTH_DATA_INVALID");
  const parsed = parseAuthenticatorData(authData, input.rpId);
  if (!parsed.attestedCredentialData) throw new Error("WEBAUTHN_ATTESTED_DATA_REQUIRED");
  let offset = 37;
  if (authData.length < offset + 18) throw new Error("WEBAUTHN_ATTESTED_DATA_INVALID");
  const aaguid = authData.subarray(offset, offset + 16); offset += 16;
  const credentialIdLength = authData.readUInt16BE(offset); offset += 2;
  if (credentialIdLength < 16 || authData.length < offset + credentialIdLength) throw new Error("WEBAUTHN_CREDENTIAL_ID_INVALID");
  const credentialId = authData.subarray(offset, offset + credentialIdLength); offset += credentialIdLength;
  const coseReader = new CborReader(authData, offset);
  const coseKey = coseReader.read();
  if (!(coseKey instanceof Map)) throw new Error("WEBAUTHN_COSE_KEY_INVALID");
  const key = coseToSpki(coseKey);
  const presentedId = input.credential.rawId || input.credential.id;
  if (presentedId && !safeEqual(fromB64url(presentedId), credentialId)) throw new Error("WEBAUTHN_CREDENTIAL_ID_MISMATCH");
  return {
    credentialId: b64url(credentialId),
    publicKeySpki: key.publicKeySpki,
    publicKeyAlgorithm: key.algorithm,
    signCount: parsed.signCount,
    aaguid: aaguid.toString("hex"),
    attachment: input.credential.authenticatorAttachment || null,
    transports: Array.isArray(input.credential.response.transports) ? input.credential.response.transports.map(String).slice(0, 16) : [],
    discoverable: input.credential.clientExtensionResults?.credProps?.rk === true,
    backupEligible: parsed.backupEligible,
    backupState: parsed.backupState,
    userVerification: parsed.userVerified ? "verified" : "present",
  };
}

export type WebAuthnAssertionCredential = {
  id: string; rawId?: string; type: string; authenticatorAttachment?: string | null;
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string | null };
};

export function webAuthnClientChallenge(credential: { response?: { clientDataJSON?: string } }) {
  try {
    const parsed = JSON.parse(fromB64url(String(credential?.response?.clientDataJSON || "")).toString("utf8"));
    return typeof parsed?.challenge === "string" ? parsed.challenge : null;
  } catch { return null; }
}

export function verifyWebAuthnAssertion(input: {
  credential: WebAuthnAssertionCredential; expectedChallenge: string; expectedOrigin: string; rpId: string;
  credentialId: string; publicKeySpki: string; publicKeyAlgorithm: string; requireUserVerification?: boolean;
}) {
  if (input.credential.type !== "public-key") throw new Error("WEBAUTHN_CREDENTIAL_TYPE_INVALID");
  const presentedId = input.credential.rawId || input.credential.id;
  if (!safeEqual(fromB64url(presentedId), fromB64url(input.credentialId))) throw new Error("WEBAUTHN_CREDENTIAL_ID_MISMATCH");
  const client = parseClientData(input.credential.response.clientDataJSON, "webauthn.get", input.expectedChallenge, input.expectedOrigin);
  const authData = fromB64url(input.credential.response.authenticatorData);
  const parsed = parseAuthenticatorData(authData, input.rpId);
  if (input.requireUserVerification && !parsed.userVerified) throw new Error("WEBAUTHN_USER_VERIFICATION_REQUIRED");
  const signed = Buffer.concat([authData, sha256Buffer(client.raw)]);
  const signature = fromB64url(input.credential.response.signature);
  const key = crypto.createPublicKey({ key: fromB64url(input.publicKeySpki), format: "der", type: "spki" });
  const algorithm = input.publicKeyAlgorithm === "EdDSA" ? null : "sha256";
  if (!crypto.verify(algorithm, signed, key, signature)) throw new Error("WEBAUTHN_SIGNATURE_INVALID");
  return {
    signCount: parsed.signCount,
    backupEligible: parsed.backupEligible,
    backupState: parsed.backupState,
    userVerification: parsed.userVerified ? "verified" : "present",
  };
}

export function webAuthnRpFromOrigin(originValue: string) {
  const parsed = new URL(originValue);
  const origin = parsed.origin;
  const hostname = parsed.hostname.toLowerCase();
  // Browser WebAuthn does not allow IP literals (including 127.0.0.1)
  // as relying-party IDs. Never accept a different RP ID than the page
  // origin: that would break attestation and origin binding.
  if (isIP(hostname.replace(/^\[|\]$/g, ""))) {
    throw new Error("WEBAUTHN_DOMAIN_REQUIRED: Open Cluster at http://localhost:3000 instead of an IP-address URL.");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && hostname === "localhost")) {
    throw new Error("WEBAUTHN_SECURE_ORIGIN_REQUIRED: Passkeys require HTTPS, except for the local localhost address.");
  }
  return { origin, rpId: hostname, rpName: "Cluster" };
}
