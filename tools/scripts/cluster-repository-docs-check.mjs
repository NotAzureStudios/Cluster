// Validate local Markdown links in maintained top-level docs without external dependencies.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const documents = [
  'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'SUPPORT.md',
  'docs/README.md', 'docs/INSTALLATION.md', 'docs/releases/CLUSTER_1_0_0.md',
  'docs/releases/CLUSTER_1_0_1.md',
  'docs/development/WINDOWS_CODE_SIGNING.md',
  'docs/development/RELEASE_ASSET_NAMING.md',
  'docs/development/LOCAL_SETUP.md', 'docs/development/GIT_WORKFLOW.md',
  'docs/development/SOURCE_SNAPSHOT_HYGIENE.md',
  'docs/development/DISTRIBUTION_PROFILES.md',
  'docs/development/SERVER_RELEASE_CHANNELS.md',
  'docs/development/NATIVE_WINDOWS_SERVER_RECOVERY.md',
  'docs/development/REPRODUCIBLE_BUILD_1_0.md',
  'docs/architecture/REPOSITORY_LAYOUT.md',
  'docs/development/RELEASE_CHECKLIST.md', 'apps/desktop-qt/README.md'
];
const failures = [];
let links = 0;
for (const document of documents) {
  const source = path.join(root, document);
  if (!existsSync(source)) { failures.push(`Missing maintained document: ${document}`); continue; }
  const markdown = readFileSync(source, 'utf8');
  // Published 1.0 guidance must not resurrect pre-lockfile or unpublished-RC claims.
  if ([
    'README.md', 'docs/README.md', 'docs/INSTALLATION.md',
    'docs/development/LOCAL_SETUP.md', 'SECURITY.md', 'SUPPORT.md'
  ].includes(document) && /no committed package-lock\\.json|package-lock\\.json is not yet tracked|the npm lockfile is not committed|no production release artifact was published/i.test(markdown)) {
    failures.push(`Obsolete unreleased-build claim in ${document}`);
  }
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().split(/\s+"/, 1)[0];
    if (!raw || raw.startsWith('#') || /^(?:https?:|mailto:|data:)/i.test(raw)) continue;
    const target = raw.split('#')[0].split('?')[0];
    if (!target) continue;
    let decoded;
    try { decoded = decodeURIComponent(target); }
    catch { failures.push(`Malformed link in ${document}: ${raw}`); continue; }
    const resolved = path.resolve(path.dirname(source), decoded);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      failures.push(`Link escapes repository: ${document} -> ${decoded}`);
    } else if (!existsSync(resolved)) {
      failures.push(`Missing link target: ${document} -> ${decoded}`);
    }
    links++;
  }
}
console.log(JSON.stringify({ maintainedDocuments: documents.length, checkedLinks: links, failures }, null, 2));
if (failures.length) process.exitCode = 1;
