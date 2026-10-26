/**
 * F2 P6: offline-readable, crash-tolerant network restart checkpoint.
 * This is NOT the server configuration commit journal.  The latter owns the
 * PostgreSQL/file transaction; this record only authorizes the native Service
 * to restore one exact, previously committed set of boot settings if its first
 * managed restart cannot reach readiness.
 *
 * The record contains encrypted boot fields and stays next to the protected
 * config file. Never return its bytes to an API caller or log its contents.
 */
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { durableReplaceFile, hasPublicationJournal, readOptionalConfigBytes } from './server-config-publication-journal.js';

const MAX_CONFIG = 4 * 1024 * 1024;
export const NETWORK_DEPLOYMENT_SUFFIX = '.network-deployment.json';
export const networkDeploymentPath = (configPath: string) => `${configPath}${NETWORK_DEPLOYMENT_SUFFIX}`;
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
export type NetworkDeploymentState = 'staged' | 'verified' | 'rolled_back';
type Snapshot = { present: boolean; bytes: string | null; sha256: string | null };
type Rollout = { schema: 1; id: string; state: NetworkDeploymentState; createdAt: string; before: Snapshot; after: Snapshot };
const snapshot = (bytes: string | null): Snapshot => {
  if (bytes !== null && Buffer.byteLength(bytes) > MAX_CONFIG) throw new Error('Network deployment snapshot is too large.');
  return { present: bytes !== null, bytes, sha256: bytes === null ? null : hash(bytes) };
};
function validateSnapshot(item: any, required: boolean): Snapshot {
  if (!item || typeof item !== 'object' || typeof item.present !== 'boolean' ||
    (required && !item.present) || (item.present ? typeof item.bytes !== 'string' || item.sha256 !== hash(item.bytes) : item.bytes !== null || item.sha256 !== null)) {
    throw new Error('Network deployment snapshot is invalid; operator recovery required.');
  }
  return snapshot(item.bytes);
}
async function readPlan(configPath: string): Promise<Rollout | null> {
  const filename = networkDeploymentPath(configPath);
  let raw: string;
  try { raw = await fs.readFile(filename, 'utf8'); }
  catch (error: any) { if (error?.code === 'ENOENT') return null; throw error; }
  if (Buffer.byteLength(raw) > MAX_CONFIG * 2 + 16 * 1024) throw new Error('Network deployment record is oversized.');
  const item = JSON.parse(raw);
  if (item?.schema !== 1 || typeof item.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(item.id) ||
      !(['staged', 'verified', 'rolled_back'].includes(item.state)) ||
      typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) {
    throw new Error('Network deployment record is malformed; operator recovery required.');
  }
  return { schema: 1, id: item.id, state: item.state, createdAt: item.createdAt,
    before: validateSnapshot(item.before, false), after: validateSnapshot(item.after, true) };
}

/** Called under the same two PostgreSQL publication advisory locks. */
export async function assertNetworkDeploymentWritable(configPath: string): Promise<void> {
  const plan = await readPlan(configPath);
  if (!plan || plan.state !== 'staged') return;
  const disk = await readOptionalConfigBytes(configPath);
  if (disk === plan.after.bytes) {
    const error = new Error('A saved network configuration has not yet passed a managed service restart. Restart and verify it before editing further server configuration.') as Error & { code: string };
    error.code = 'NETWORK_DEPLOYMENT_PENDING';
    throw error;
  }
  if (disk !== plan.before.bytes) throw new Error('Network deployment record does not match either recorded configuration; manual recovery required.');
  // The previous transaction aborted and its publication journal was recovered.
  // A new staged change can replace that inert record while holding the locks.
}

/** Must run AFTER the publication journal is durably written, and BEFORE config replacement. */
export async function stageNetworkDeployment(configPath: string, before: string | null, after: string, id = randomUUID()): Promise<void> {
  if (!(await hasPublicationJournal(configPath))) throw new Error('Network rollout requires the durable configuration publication journal.');
  if (before === after) return;
  const plan: Rollout = { schema: 1, id, state: 'staged', createdAt: new Date().toISOString(), before: snapshot(before), after: snapshot(after) };
  await durableReplaceFile(networkDeploymentPath(configPath), `${JSON.stringify(plan)}\n`);
}

/** Safe, redacted admin status; never disclose plaintext or encrypted boot values. */
export async function readNetworkDeploymentStatus(configPath: string) {
  const plan = await readPlan(configPath);
  if (!plan) return { state: 'none' as const, requiresManagedRestart: false };
  const disk = await readOptionalConfigBytes(configPath);
  const matches = disk === plan.after.bytes ? 'candidate' : disk === plan.before.bytes ? 'previous' : 'unexpected';
  return { state: plan.state, createdAt: plan.createdAt, requiresManagedRestart: plan.state === 'staged' && matches === 'candidate',
    configMatch: matches, publicationPending: await hasPublicationJournal(configPath),
    advisory: plan.state === 'staged' ? 'Restart the independent Windows Service to verify local readiness. External TLS and remote connectivity still require operator testing.' :
      plan.state === 'rolled_back' ? 'The supervisor restored the previous configuration after a failed managed start; inspect service logs.' :
      'The new configuration passed the native managed service readiness gate.' };
}
