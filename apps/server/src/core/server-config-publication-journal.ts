/**
 * Crash-recoverable publication for the server-managed configuration file.
 *
 * The file replacement and PostgreSQL transaction cannot commit atomically.
 * A fsynced, versioned journal is placed on disk before the replacement, and
 * the matching commit ID is stored in AppSetting inside the SAME DB transaction.
 * Recovery must hold both server settings advisory locks before consulting the
 * committed ID. A corrupted, unexpected or externally modified file fails closed.
 * Journal contents can include encrypted boot settings and must remain owner-only.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const SERVER_CONFIG_COMMIT_SETTING = '_internal.serverConfigPublicationId';
const JOURNAL_SUFFIX = '.publication-journal.json';
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_JOURNAL_BYTES = MAX_FILE_BYTES * 2 + 16 * 1024;

type JournalSnapshot = { present: boolean; bytes: string | null; sha256: string | null };
export type ServerConfigPublicationJournal = {
  schema: 1;
  id: string;
  before: JournalSnapshot;
  after: JournalSnapshot;
};

function hash(bytes: string): string { return createHash('sha256').update(bytes).digest('hex'); }
function snapshot(bytes: string | null): JournalSnapshot {
  if (bytes !== null && Buffer.byteLength(bytes) > MAX_FILE_BYTES) throw new Error('Server configuration exceeds publication size limit.');
  return { present: bytes !== null, bytes, sha256: bytes === null ? null : hash(bytes) };
}
function validateSnapshot(input: any, allowMissing: boolean): JournalSnapshot {
  if (!input || typeof input !== 'object' || typeof input.present !== 'boolean' ||
      (input.present ? typeof input.bytes !== 'string' || typeof input.sha256 !== 'string' || input.sha256 !== hash(input.bytes) :
        !allowMissing || input.bytes !== null || input.sha256 !== null)) {
    throw new Error('Server configuration publication journal is corrupt; automatic recovery stopped.');
  }
  return snapshot(input.bytes);
}
function validateJournal(input: any): ServerConfigPublicationJournal {
  if (!input || input.schema !== 1 || typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.id)) {
    throw new Error('Unsupported or damaged server configuration publication journal.');
  }
  return { schema: 1, id: input.id, before: validateSnapshot(input.before, true), after: validateSnapshot(input.after, false) };
}

export function journalPath(configPath: string): string { return `${configPath}${JOURNAL_SUFFIX}`; }

async function syncDirectory(filePath: string): Promise<void> {
  // Directory sync is supported by POSIX, but Windows can reject directory handles.
  try {
    const directory = await fs.open(path.dirname(filePath), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } catch { /* best effort: the actual file has already been synced */ }
}

/** Atomic same-directory replacement with owner-only file permissions. */
export async function durableReplaceFile(filePath: string, bytes: string): Promise<void> {
  if (Buffer.byteLength(bytes) > (filePath.endsWith(JOURNAL_SUFFIX) ? MAX_JOURNAL_BYTES : MAX_FILE_BYTES)) throw new Error('Server configuration exceeds publication size limit.');
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temporary, filePath);
    await fs.chmod(filePath, 0o600).catch(() => undefined);
    await syncDirectory(filePath);
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function readOptionalConfigBytes(filePath: string): Promise<string | null> {
  try { return await fs.readFile(filePath, 'utf8'); }
  catch (error: any) { if (error?.code === 'ENOENT') return null; throw error; }
}

export async function hasPublicationJournal(configPath: string): Promise<boolean> {
  try { await fs.stat(journalPath(configPath)); return true; }
  catch (error: any) { if (error?.code === 'ENOENT') return false; throw error; }
}

/** Must be invoked with the server publication advisory lock held. */
export async function prepareConfigPublication(configPath: string, afterBytes: string): Promise<ServerConfigPublicationJournal> {
  if (await hasPublicationJournal(configPath)) throw new Error('Unresolved server configuration publication journal blocks new writes.');
  const journal: ServerConfigPublicationJournal = {
    schema: 1, id: randomUUID(), before: snapshot(await readOptionalConfigBytes(configPath)), after: snapshot(afterBytes),
  };
  await durableReplaceFile(journalPath(configPath), `${JSON.stringify(journal)}\n`);
  return journal;
}

/** Must be invoked with the server publication advisory lock held. */
export async function recoverConfigPublication(configPath: string, committedId: string | null): Promise<'none' | 'committed' | 'rolled_back'> {
  const raw = await readOptionalConfigBytes(journalPath(configPath));
  if (raw === null) return 'none';
  const journal = validateJournal(JSON.parse(raw));
  const current = await readOptionalConfigBytes(configPath);
  if (current !== journal.before.bytes && current !== journal.after.bytes) {
    throw new Error('Server configuration differs from both recorded publication versions. Manual recovery required; refusing to overwrite it.');
  }
  const committed = committedId === journal.id;
  const target = committed ? journal.after.bytes : journal.before.bytes;
  if (target === null) {
    if (current !== null) { await fs.unlink(configPath); await syncDirectory(configPath); }
  } else if (current !== target) {
    await durableReplaceFile(configPath, target);
  }
  await clearPublicationJournal(configPath);
  return committed ? 'committed' : 'rolled_back';
}

export async function clearPublicationJournal(configPath: string): Promise<void> {
  await fs.unlink(journalPath(configPath));
  await syncDirectory(journalPath(configPath));
}

export function serializeConfigPublication(settings: Record<string, unknown>, encryptionKeyId: string | null): string {
  return `${JSON.stringify({ version: 2, updatedAt: new Date().toISOString(), secretPolicy: 'server-managed-only', encryptionKeyId, settings }, null, 2)}\n`;
}
