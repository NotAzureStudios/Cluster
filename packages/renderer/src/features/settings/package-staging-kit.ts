/**
 * Offline handoff for the independent native Package stager. The files bundled
 * here remain UNTRUSTED until the native stager checks a separately provisioned
 * Ed25519 SPKI pin. Never bundle a trust assertion or a receipt challenge.
 * ZIP entries are stored, not compressed: signed Package artifacts already
 * contain their own ZIP and compression adds no useful value here.
 */
export type StagingKitInput = {
  archive: Uint8Array;
  filename: string;
  manifest: {
    schema: 1; packageKey: string; version: string; platform: string;
    artifactSha256: string; artifactSize: number; filename: string;
  };
  signatureBase64: string;
  publicKeyPem: string;
};

const utf8 = (value: string) => new TextEncoder().encode(value);
const maxArchiveBytes = 4 * 1024 * 1024;

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safeFilename(name: string) {
  // The filename is server-controlled metadata, but must not become a ZIP path.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,149}\.zip$/.test(name)) throw new Error("Invalid signed Package filename.");
  return name;
}

export function buildPackageStagingKit(input: StagingKitInput): Blob {
  const { archive, manifest, signatureBase64, publicKeyPem } = input;
  if (archive.byteLength < 1 || archive.byteLength > maxArchiveBytes || manifest.artifactSize !== archive.byteLength || input.filename !== manifest.filename)
    throw new Error("Package size or signed manifest filename mismatch.");
  if (!/^[a-z][a-z0-9-]{2,79}$/.test(manifest.packageKey) || !/^[a-f0-9]{64}$/.test(manifest.artifactSha256)
    || !/^[A-Za-z0-9+/]{86}==$/.test(signatureBase64) || !publicKeyPem.startsWith("-----BEGIN PUBLIC KEY-----"))
    throw new Error("Invalid signed Package handoff metadata.");
  safeFilename(input.filename);
  const readme = [
    "Cluster Managed Package staging handoff (NOT INSTALLED)",
    "",
    "This bundle contains a downloaded Package ZIP, its signed manifest, its",
    "signature and a public key supplied by the Cluster server.",
    "The bundled public key IS NOT an independent trust root.",
    "Get its SHA-256 DER/SPKI fingerprint from a separately trusted administrator",
    "or provisioned workstation configuration. Do NOT calculate the trusted pin",
    "from the public-key.pem file in this kit and assume it is approved.",
    "",
    "Extract the kit into a private temporary folder, then run:",
    "cluster-package-stager --archive release.zip --manifest manifest.json",
    "  --signature signature.txt --public-key public-key.pem",
    "  --trusted-key-sha256 <INDEPENDENTLY_PROVISIONED_SHA256> --root <PRIVATE_STAGING_ROOT>",
    "",
    "Staging does not run software, install it, activate it or attest device health.",
    "The server may revoke an entitlement after this kit was downloaded.",
    "A currently authorized native client must recheck policy before any later selection.",
    "No device receipt secrets or login tokens are included in this bundle.",
    "",
  ].join("\n");
  const entries: Array<{ name: string; data: Uint8Array }> = [
    { name: "release.zip", data: archive },
    { name: "manifest.json", data: utf8(JSON.stringify(manifest)) },
    { name: "signature.txt", data: utf8(signatureBase64 + "\n") },
    { name: "public-key.pem", data: utf8(publicKeyPem) },
    { name: "README.txt", data: utf8(readme) },
  ];
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = utf8(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true); // UTF-8 names
    header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const central = new Uint8Array(46 + nameBytes.length);
    const index = new DataView(central.buffer);
    index.setUint32(0, 0x02014b50, true);
    index.setUint16(4, 20, true);
    index.setUint16(6, 20, true);
    index.setUint16(8, 0x0800, true);
    index.setUint32(16, crc, true);
    index.setUint32(20, data.length, true);
    index.setUint32(24, data.length, true);
    index.setUint16(28, nameBytes.length, true);
    index.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    localParts.push(local, data);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, bytes) => sum + bytes.length, 0);
  const end = new Uint8Array(22);
  const footer = new DataView(end.buffer);
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, entries.length, true);
  footer.setUint16(10, entries.length, true);
  footer.setUint32(12, centralSize, true);
  footer.setUint32(16, offset, true);
  // Copy individual views to avoid Blob / SharedArrayBuffer browser variation.
  return new Blob([...localParts, ...centralParts, end].map((part) => new Uint8Array(part)), { type: "application/zip" });
}
