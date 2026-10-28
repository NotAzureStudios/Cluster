// Build the tiny root-level Windows launcher. The installed native manager,
// not this entrypoint, owns Node, PostgreSQL, API and browser lifecycle.
import { readFileSync, mkdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const identity = JSON.parse(readFileSync(path.join(root, 'config/release-candidate.json'), 'utf8'));
const entry = path.join(root, 'tools/server-entry-go');
const target = path.join(root, 'bin/Cluster Server.exe');
mkdirSync(path.dirname(target), { recursive: true });
const result = spawnSync(process.env.GO_EXE || 'go', [
  'build', '-trimpath', '-buildvcs=false',
  `-ldflags=-s -w -H=windowsgui -X main.releaseCandidate=${identity.release}`,
  '-o', target, '.',
], { cwd: entry, env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0', GOTOOLCHAIN: 'local' }, encoding: 'utf8', timeout: 120000 });
if (result.error || result.status !== 0) throw new Error(`Root server launcher build failed: ${result.error?.message || `${result.stdout}\n${result.stderr}`}`);
if (readFileSync(target).subarray(0, 2).toString('ascii') !== 'MZ') throw new Error('Root launcher must be a Windows PE executable.');
console.log(`Root Cluster Server.exe (${identity.release}) built: ${statSync(target).size} bytes`);
