import { createHash, createPrivateKey, sign } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${rawKey}.`);
    values.set(rawKey, value);
  }
  return values;
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error(`Unsupported manifest value: ${typeof value}`);
}

function validVersion(value) {
  return /^\d+\.\d+\.\d+$/.test(value);
}

function validateDescriptor(descriptor, index) {
  const allowedPlatforms = new Set(["windows", "linux", "macos"]);
  const allowedArchitectures = new Set(["x64", "arm64"]);
  const allowedKinds = new Set(["installer", "portable", "rollback"]);
  if (!allowedPlatforms.has(descriptor.platform)) throw new Error(`Artifact ${index}: invalid platform.`);
  if (!allowedArchitectures.has(descriptor.arch)) throw new Error(`Artifact ${index}: invalid architecture.`);
  if (!allowedKinds.has(descriptor.kind)) throw new Error(`Artifact ${index}: invalid kind.`);
  if (!validVersion(descriptor.version)) throw new Error(`Artifact ${index}: version must use major.minor.patch.`);
  if (!descriptor.path || typeof descriptor.path !== "string") throw new Error(`Artifact ${index}: path is required.`);
  if (descriptor.url !== undefined && (typeof descriptor.url !== "string" || !descriptor.url.trim())) throw new Error(`Artifact ${index}: url must be a non-empty string.`);
}

async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

const args = parseArgs(process.argv.slice(2));
const privateKeyPath = args.get("private-key");
const artifactsPath = args.get("artifacts");
const outputPath = args.get("out") || path.join(root, "release", "RELEASE_MANIFEST.json");
const version = args.get("version") || packageJson.version;
const channel = args.get("channel") || "stable";

if (!privateKeyPath) throw new Error("--private-key is required. Keep the Ed25519 private key outside the repository.");
if (!artifactsPath) throw new Error("--artifacts is required and must point to a JSON array of artifact descriptors.");
if (!validVersion(version)) throw new Error("--version must use numeric major.minor.patch format.");
if (!["stable", "beta", "nightly"].includes(channel)) throw new Error("--channel must be stable, beta, or nightly.");

await access(privateKeyPath);
const key = createPrivateKey(await readFile(privateKeyPath));
if (key.asymmetricKeyType !== "ed25519") throw new Error("The update signing key must be Ed25519.");

const descriptors = JSON.parse(await readFile(artifactsPath, "utf8"));
if (!Array.isArray(descriptors) || descriptors.length < 1 || descriptors.length > 16) {
  throw new Error("Artifact descriptor file must contain between 1 and 16 entries.");
}

const artifacts = [];
for (let index = 0; index < descriptors.length; index += 1) {
  const descriptor = descriptors[index];
  validateDescriptor(descriptor, index);
  const artifactPath = path.resolve(path.dirname(path.resolve(artifactsPath)), descriptor.path);
  const info = await stat(artifactPath);
  if (!info.isFile() || info.size <= 0 || info.size > 2 * 1024 * 1024 * 1024) {
    throw new Error(`Artifact ${index}: file size must be between 1 byte and 2 GiB.`);
  }
  const filename = descriptor.filename || path.basename(artifactPath);
  if (!filename || filename === "." || filename === ".." || /[\\/]/.test(filename)) {
    throw new Error(`Artifact ${index}: filename is unsafe.`);
  }
  artifacts.push({
    platform: descriptor.platform,
    arch: descriptor.arch,
    kind: descriptor.kind,
    version: descriptor.version,
    filename,
    url: descriptor.url || filename,
    sha256: await sha256File(artifactPath),
    size: info.size,
  });
}

const unsignedManifest = {
  schemaVersion: 1,
  product: "cluster-desktop",
  channel,
  version,
  publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  artifacts,
};
const signature = sign(null, Buffer.from(canonicalJson(unsignedManifest), "utf8"), key).toString("base64");
const manifest = { ...unsignedManifest, signature };

await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(`Signed Cluster Desktop update manifest written to ${path.resolve(outputPath)}.`);
