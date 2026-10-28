/** Type-check the exact recovered fragments against strict compiler fixtures.
 * This catches the three RC2 Windows errors without requiring React/Vite or a
 * running PostgreSQL instance. Full npm workspace build remains mandatory.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const renderer = path.join(root, 'packages/renderer/src');
const load = (p) => fs.readFileSync(path.join(renderer, p), 'utf8');
const between = (s, left, right) => {
  const start = s.indexOf(left);
  assert.ok(start >= 0, `Missing source boundary: ${left}`);
  const end = s.indexOf(right, start + left.length);
  assert.ok(end > start, `Missing source boundary: ${right}`);
  return s.slice(start, end);
};
const desktop = load('core/desktop.ts');
const recovery = between(desktop, 'export async function recoverNativePackageArchive(', 'export async function bindNativePackageArchiveOffer(');
const calendar = load('features/calendar/CalendarPage.tsx');
const attendance = between(calendar, '  const [attendance, setAttendance]', '\n  const [error, setError]');
const cascade = load('features/settings/msi-rollback-cascade.ts').replace(/^import type .*\n/, 'type ClusterNativeMSIRollbackCascade = Record<string, unknown>;\n');
const snippets = [
  `type NativePackageTransferCheckpoint = { digest: string; recoveryAction?: string; recoveredBytes?: number; receivedBytes: number; expectedBytes: number };\ndeclare function requestNativeCapability<T>(name: string, input: Record<string, unknown>): Promise<T>;\n${recovery}`,
  `type CalendarResponse = { userId: string; attendance?: string | null };\ndeclare const responsesForOccurrence: CalendarResponse[];\ndeclare const event: { meeting?: { attendance?: Record<string, string> } } | undefined;\ndeclare function useState<T>(initializer: () => T): [T, (next: T) => void];\n${attendance}`,
  cascade,
];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cluster-rc3-type-'));
try {
  snippets.forEach((s, i) => fs.writeFileSync(path.join(dir, `regression${i}.ts`), `export {};\n${s}\n`));
  const require = createRequire(import.meta.url);
  const tsc = require.resolve('typescript/bin/tsc');
  const result = spawnSync(process.execPath, [tsc, '--strict', '--noEmit', '--target', 'ES2022', '--skipLibCheck', '--module', 'esnext', ...snippets.map((_, i) => path.join(dir, `regression${i}.ts`))], { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`Strict RC3 type checks failed:\n${result.stdout}\n${result.stderr}`);
  console.log('3/3 actual source fragments passed strict TypeScript semantic compilation');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
