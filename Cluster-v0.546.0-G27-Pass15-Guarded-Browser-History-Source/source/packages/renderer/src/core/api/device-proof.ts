const DB_NAME = "cluster-device-proof";
const STORE_NAME = "keys";
const ACTIVE_RECORD_ID = "installation";
const PENDING_RECORD_ID = "rotation-pending";
const PROOF_VERSION = "cluster-device-proof-v1";

type StoredDeviceKey = {
  id: string;
  privateKey: CryptoKey;
  publicKeySpki: string;
  keyFingerprint: string;
};

let cachedKey: StoredDeviceKey | null = null;
let keyPromise: Promise<StoredDeviceKey | null> | null = null;

function base64Url(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function fingerprint(spki: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", spki);
  return `sha256:${base64Url(digest).slice(0, 32)}`;
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Device proof storage could not be opened."));
  });
}

async function readStoredKey(id = ACTIVE_RECORD_ID) {
  const db = await openDb();
  try {
    return await new Promise<StoredDeviceKey | null>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve((request.result as StoredDeviceKey | undefined) || null);
      request.onerror = () => reject(request.error || new Error("Device proof key could not be read."));
    });
  } finally {
    db.close();
  }
}

async function writeStoredKey(record: StoredDeviceKey) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error("Device proof key storage was aborted."));
      transaction.onerror = () => reject(transaction.error || new Error("Device proof key could not be stored."));
      transaction.objectStore(STORE_NAME).put(record);
    });
  } finally {
    db.close();
  }
}

async function promotePendingStoredKey(record: StoredDeviceKey) {
  const active: StoredDeviceKey = { ...record, id: ACTIVE_RECORD_ID };
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error("Device proof key promotion was aborted."));
      transaction.onerror = () => reject(transaction.error || new Error("Device proof key could not be promoted."));
      const store = transaction.objectStore(STORE_NAME);
      store.put(active);
      store.delete(PENDING_RECORD_ID);
    });
  } finally {
    db.close();
  }
  cachedKey = active;
  return active;
}

async function createStoredKey(id: string): Promise<StoredDeviceKey> {
  // WebCrypto needs the generated private key to be temporarily exportable so it can
  // be re-imported as non-exportable while still allowing the public SPKI to be sent.
  // The persisted/private key Cluster actually retains is never exportable.
  const generated = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const [publicSpki, privateJwk] = await Promise.all([
    crypto.subtle.exportKey("spki", generated.publicKey),
    crypto.subtle.exportKey("jwk", generated.privateKey),
  ]);
  const privateKey = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const record: StoredDeviceKey = {
    id,
    privateKey,
    publicKeySpki: base64Url(publicSpki),
    keyFingerprint: await fingerprint(publicSpki),
  };
  await writeStoredKey(record);
  return record;
}

async function deviceKey() {
  if (cachedKey) return cachedKey;
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    if (typeof window === "undefined" || !window.indexedDB || !window.crypto?.subtle) return null;
    try {
      const stored = await readStoredKey(ACTIVE_RECORD_ID);
      cachedKey = stored || await createStoredKey(ACTIVE_RECORD_ID);
      return cachedKey;
    } catch {
      return null;
    } finally {
      keyPromise = null;
    }
  })();
  return keyPromise;
}

export async function createDeviceProofHeaders(input: { deviceId: string; pathname: string; method: string; requestId: string }) {
  const key = await deviceKey();
  if (!key) return null;
  const timestamp = String(Date.now());
  const message = [PROOF_VERSION, input.deviceId, input.method.toUpperCase(), input.pathname, input.requestId, timestamp].join("\n");
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, new TextEncoder().encode(message));
  return {
    "X-Cluster-Device-Id": input.deviceId,
    "X-Cluster-Device-Proof-Timestamp": timestamp,
    "X-Cluster-Device-Proof-Signature": base64Url(signature),
    "X-Cluster-Device-Proof-Public-Key": key.publicKeySpki,
    "X-Cluster-Device-Proof-Algorithm": "ES256",
  };
}

export async function currentDeviceProofKeyFingerprint() {
  return (await deviceKey())?.keyFingerprint || null;
}

export async function createDeviceProofRotationPayload(deviceId: string) {
  if (typeof window === "undefined" || !window.indexedDB || !window.crypto?.subtle) throw new Error("Secure device-key storage is unavailable in this client.");
  // Always stage a fresh replacement. The active key remains untouched and continues
  // signing normal requests until the server explicitly accepts this fingerprint.
  const replacement = await createStoredKey(PENDING_RECORD_ID);
  const timestamp = String(Date.now());
  const message = ["cluster-device-proof-rotate-v1", deviceId, timestamp].join("\n");
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, replacement.privateKey, new TextEncoder().encode(message));
  return { publicKeySpki: replacement.publicKeySpki, signature: base64Url(signature), timestamp, keyFingerprint: replacement.keyFingerprint };
}

export async function promotePendingDeviceProofKey(expectedFingerprint: string | null | undefined) {
  const expected = String(expectedFingerprint || "").trim();
  if (!expected) return false;
  const pending = await readStoredKey(PENDING_RECORD_ID).catch(() => null);
  if (!pending || pending.keyFingerprint !== expected) return false;
  await promotePendingStoredKey(pending);
  return true;
}

export async function recoverPendingDeviceProofKey(serverFingerprint: string | null | undefined) {
  return promotePendingDeviceProofKey(serverFingerprint);
}
