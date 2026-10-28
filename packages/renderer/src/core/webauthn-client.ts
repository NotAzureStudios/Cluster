function bytesFromBase64Url(value: string) {
  const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value || "").length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlFromBuffer(value: ArrayBuffer | ArrayBufferView | null) {
  if (!value) return null;
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function webAuthnAvailable() {
  return typeof window !== "undefined" && "PublicKeyCredential" in window && Boolean(navigator.credentials);
}

/** Block impossible registrations before making a rate-limited API request. */
export function requireWebAuthnBrowserOrigin() {
  if (typeof window === "undefined") return;
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === "127.0.0.1" || /^127\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const port = window.location.port ? `:${window.location.port}` : "";
    throw new Error(`Passkeys cannot enroll using an IP-address URL. Open Cluster at http://localhost${port} and try again.`);
  }
  if (window.location.protocol !== "https:" && !(window.location.protocol === "http:" && hostname === "localhost")) {
    throw new Error("Passkeys require an HTTPS domain or a local http://localhost address.");
  }
}

export async function createWebAuthnCredential(options: any) {
  if (!webAuthnAvailable()) throw new Error("Passkeys are not available in this browser or runtime.");
  requireWebAuthnBrowserOrigin();
  const publicKey: PublicKeyCredentialCreationOptions = {
    ...options,
    challenge: bytesFromBase64Url(options.challenge),
    user: { ...options.user, id: bytesFromBase64Url(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((item: any) => ({ ...item, id: bytesFromBase64Url(item.id) })),
  };
  const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null;
  if (!credential) throw new Error("Passkey creation was cancelled.");
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: base64UrlFromBuffer(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || null,
    clientExtensionResults: typeof credential.getClientExtensionResults === "function" ? credential.getClientExtensionResults() : {},
    response: {
      clientDataJSON: base64UrlFromBuffer(response.clientDataJSON),
      attestationObject: base64UrlFromBuffer(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : [],
    },
  };
}

export async function getWebAuthnCredential(options: any) {
  if (!webAuthnAvailable()) throw new Error("Passkeys are not available in this browser or runtime.");
  requireWebAuthnBrowserOrigin();
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...options,
    challenge: bytesFromBase64Url(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((item: any) => ({ ...item, id: bytesFromBase64Url(item.id) })),
  };
  const credential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null;
  if (!credential) throw new Error("Passkey verification was cancelled.");
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: base64UrlFromBuffer(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || null,
    response: {
      clientDataJSON: base64UrlFromBuffer(response.clientDataJSON),
      authenticatorData: base64UrlFromBuffer(response.authenticatorData),
      signature: base64UrlFromBuffer(response.signature),
      userHandle: base64UrlFromBuffer(response.userHandle),
    },
  };
}
