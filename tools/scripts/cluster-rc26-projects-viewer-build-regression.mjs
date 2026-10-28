// Regression for the two RC25 TypeScript compilation failures reported by the
// Windows clean-room installer. A source scan alone did not detect these errors.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const iconSource = read("packages/renderer/src/components/ClusterIcon.tsx");
const iconUnion = iconSource.match(/export type ClusterIconName\s*=([\s\S]*?);/);
assert.ok(iconUnion, "ClusterIconName union is available");
const allowedIcons = new Set(Array.from(iconUnion[1].matchAll(/"([^"]+)"/g), (match) => match[1]));
assert.ok(allowedIcons.has("note"), "Details action uses a valid icon");
const projects = read("packages/renderer/src/features/projects/ProjectsPage.tsx");
for (const match of projects.matchAll(/<ClusterIcon\s+name="([^"]+)"/g)) {
  assert.ok(allowedIcons.has(match[1]), `Unsupported Project icon: ${match[1]}`);
}
assert.match(projects, /aria-expanded=\{inspectorOpen\}/, "Project details remain accessible");
assert.match(projects, /<ClusterIcon name="note" \/>/, "Details icon remains registered");
const viewer = read("packages/renderer/src/features/viewer/viewer-system-integration.ts");
assert.match(viewer, /import\s*\{[^}]*\bAPI_URL\b[^}]*\bapi\b[^}]*\}\s*from\s*["']\.\.\/\.\.\/core\/api["']/);
assert.match(viewer, /new URL\(`\$\{API_URL\}\$\{relative\}`/, "Viewer drag-drop resolves API origin");
const api = read("packages/renderer/src/core/api/index.ts");
assert.match(api, /export\s*\{[^}]*\bAPI_URL\b[^}]*\}\s*from\s*["']\.\/config["']/);
const meta = JSON.parse(read("config/release-candidate.json"));
assert.ok(meta.sequence >= 26);
assert.equal(meta.release, `1.0.0-rc.${meta.sequence}`);
console.log("RC26 Projects icon + Viewer API_URL build regression: PASS");
