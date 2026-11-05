// Dependency-free Git source-hygiene gate. Only inspect tracked paths, never live server files.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createPublicKey } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean).map((p) => p.replaceAll('\\', '/'));
const failures = [];
const forbidden = /(^|\/)(?:node_modules|\.git|dist|build|coverage|\.cache|\.next)(\/|$)|(^|\/)\.env(?:\.[^/]*)?$|\.(?:exe|dll|msi|p12|pfx|key|sqlite|sqlite3|db|log)$/i;
// Only these audited, non-secret Ed25519 trust roots are allowed in source.
// Never whitelist a whole directory or arbitrary .pem files.
const trustedPublicKeys = new Set([
  'apps/desktop-qt/assets/update-public-key.pem',
  'apps/server-launcher-go/assets/server-update-public-key.pem',
]);
for (const p of tracked) {
  if (forbidden.test(p) || (p.endsWith('.pem') && !trustedPublicKeys.has(p))) {
    failures.push(`Unexpected tracked runtime, binary or private file: ${p}`);
  }
  if (trustedPublicKeys.has(p)) {
    try {
      const contents = readFileSync(path.join(root, p), 'utf8').trim();
      if (!contents.startsWith('-----BEGIN PUBLIC KEY-----')
          || !contents.endsWith('-----END PUBLIC KEY-----')
          || createPublicKey(contents).asymmetricKeyType !== 'ed25519') {
        failures.push(`Trusted release key is not an Ed25519 public key: ${p}`);
      }
    } catch {
      failures.push(`Invalid PEM trust root: ${p}`);
    }
  }
}
const required = ['.gitignore', '.gitattributes', 'package.json', 'config/release-candidate.json'];
for (const p of required) if (!tracked.includes(p)) failures.push(`Missing tracked source metadata: ${p}`);
if (existsSync(path.join(root, '.npmrc')) && /(?:_authToken|_password|_auth\s*=)/i.test(readFileSync(path.join(root, '.npmrc'), 'utf8'))) {
  failures.push('Credentials or authentication configuration detected in tracked .npmrc');
}
if (tracked.includes('SOURCE_FILE_MANIFEST.sha256')) failures.push('Generated source archive manifest tracked; leave this in release bundles');
const locked = existsSync(path.join(root, 'package-lock.json'));
const report = { trackedFiles: tracked.length, sourceHygiene: failures.length ? 'FAILED' : 'PASS',
  dependencyLockfile: locked ? 'PRESENT_UNVERIFIED' : 'MISSING_RELEASE_BLOCKER', failures };
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
