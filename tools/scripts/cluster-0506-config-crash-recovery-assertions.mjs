import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  durableReplaceFile, hasPublicationJournal, journalPath, prepareConfigPublication,
  readOptionalConfigBytes, recoverConfigPublication, serializeConfigPublication,
} from '../../apps/server/src/core/server-config-publication-journal.ts';

let passed = 0;
async function check(label, fn) {
  await fn(); passed++; console.log(`PASS ${label}`);
}
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cluster-0506-config-journal-'));
try {
  const file = path.join(temp, 'cluster.config.json');
  const config = (port) => serializeConfigPublication({serverHost:'127.0.0.1',serverPort:port},null);
  const before = config(3000), after = config(4000);

  await check('file publication preserves its original contents before journaling', async () => {
    await durableReplaceFile(file, before);
    assert.equal(await readOptionalConfigBytes(file), before);
    assert.equal(await hasPublicationJournal(file), false);
    if(process.platform!=='win32')assert.equal((await fs.stat(file)).mode&0o777,0o600);
  });
  await check('crash after fsynced journal but before file rename rolls back', async () => {
    const j=await prepareConfigPublication(file,after);
    assert.equal(await hasPublicationJournal(file),true);
    assert.equal(await recoverConfigPublication(file,'some-other-transaction'), 'rolled_back');
    assert.equal(await readOptionalConfigBytes(file),before);
    assert.equal(await hasPublicationJournal(file),false);
    assert.ok(j.id);
  });
  await check('crash after file rename and DB rollback restores previous bytes', async () => {
    await prepareConfigPublication(file,after);
    await durableReplaceFile(file,after);
    assert.equal(await recoverConfigPublication(file,'previous-commit'),'rolled_back');
    assert.equal(await readOptionalConfigBytes(file),before);
  });
  await check('DB committed before process death retains new bytes on recovery', async () => {
    const j=await prepareConfigPublication(file,after);
    await durableReplaceFile(file,after);
    assert.equal(await recoverConfigPublication(file,j.id),'committed');
    assert.equal(await readOptionalConfigBytes(file),after);
    assert.equal(await recoverConfigPublication(file,j.id),'none');
  });
  await check('commit marker repairs config unexpectedly still at previous bytes', async () => {
    await durableReplaceFile(file,before);
    const j=await prepareConfigPublication(file,after);
    assert.equal(await recoverConfigPublication(file,j.id),'committed');
    assert.equal(await readOptionalConfigBytes(file),after);
  });
  await check('originally absent file is deleted on aborted first publication', async () => {
    await fs.unlink(file);
    await prepareConfigPublication(file,after);
    await durableReplaceFile(file,after);
    assert.equal(await recoverConfigPublication(file,null),'rolled_back');
    assert.equal(await readOptionalConfigBytes(file),null);
  });
  await check('modified config fails closed without deleting journal or modifications', async () => {
    await durableReplaceFile(file,before);
    await prepareConfigPublication(file,after);
    const unexpected = config(9999);
    await durableReplaceFile(file,unexpected);
    await assert.rejects(recoverConfigPublication(file,null),/differs from both/);
    assert.equal(await readOptionalConfigBytes(file),unexpected);
    assert.equal(await hasPublicationJournal(file),true);
    await fs.unlink(journalPath(file));
  });
  await check('damaged journal fails closed without mutating config', async () => {
    const j=await prepareConfigPublication(file,after);
    const raw=JSON.parse(await fs.readFile(journalPath(file),'utf8'));
    raw.before.sha256='0'.repeat(64);
    await durableReplaceFile(journalPath(file),JSON.stringify(raw));
    await assert.rejects(recoverConfigPublication(file,j.id),/corrupt/);
    assert.equal(JSON.parse(await readOptionalConfigBytes(file)).settings.serverPort,9999);
    assert.equal(await hasPublicationJournal(file),true);
    await fs.unlink(journalPath(file));
  });
  await check('second journal cannot replace an unresolved first publication', async () => {
    await prepareConfigPublication(file,after);
    await assert.rejects(prepareConfigPublication(file,before),/Unresolved/);
    assert.equal(await recoverConfigPublication(file,null),'rolled_back');
  });
  await check('journal file is private and contains only the recorded config snapshots', async () => {
    await prepareConfigPublication(file,after);
    const stat=await fs.stat(journalPath(file));
    if(process.platform!=='win32')assert.equal(stat.mode&0o777,0o600);
    const raw=JSON.parse(await fs.readFile(journalPath(file),'utf8'));
    assert.deepEqual(Object.keys(raw).sort(),['after','before','id','schema']);
    await recoverConfigPublication(file,null);
  });
  await check('oversized future file is rejected before modifying journal or config', async () => {
    const huge='a'.repeat(4*1024*1024+1);
    await assert.rejects(prepareConfigPublication(file,huge),/size limit/);
    assert.equal(await hasPublicationJournal(file),false);
  });
  const svc = await fs.readFile('apps/server/src/app/server-services-settings-integrations.ts','utf8');
  const boot=await fs.readFile('apps/server/src/app/cluster-server.ts','utf8');
  await check('service commits marker in same transaction and reconciles journals under locks', async () => {
    const begin=svc.indexOf('async function saveSettings('), end=svc.indexOf('function maskConfiguredSecret',begin);
    const segment=svc.slice(begin,end);
    assert.ok(segment.indexOf('await persistDatabaseSettings(next, tx)')<segment.indexOf('await prepareConfigPublication('));
    assert.ok(segment.indexOf('await prepareConfigPublication(')<segment.indexOf('await durableReplaceFile(CONFIG_FILE_PATH, afterBytes)'));
    assert.ok(segment.indexOf('await durableReplaceFile(CONFIG_FILE_PATH, afterBytes)')<segment.indexOf('await tx.appSetting.upsert('));
    assert.match(segment,/SERVER_CONFIG_COMMIT_SETTING/);
    assert.match(segment,/await recoverPendingConfigPublicationUnderLock\(tx\)/);
    assert.match(segment,/await recoverPendingConfigPublication\(\)/);
  });
  await check('startup refuses stale boot settings after reconciliation', async () => {
    const start=boot.indexOf('export async function startClusterServer()');
    const segment=boot.slice(start,start+2500);
    assert.match(segment,/await verifyPostgresqlSchema/);
    assert.match(segment,/await recoverPendingConfigPublication\(\)/);
    assert.match(segment,/Restart Cluster so runtime parameters reload safely/);
    assert.ok(segment.indexOf('await recoverPendingConfigPublication()')<segment.indexOf('await syncEditableDataMirrors'));
  });
  console.log(`${passed}/13 configuration crash recovery assertions passed`);
} finally { await fs.rm(temp,{recursive:true,force:true}); }
