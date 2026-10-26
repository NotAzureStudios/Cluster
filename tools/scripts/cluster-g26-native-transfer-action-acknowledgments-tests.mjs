import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
const header = read('apps/desktop-qt/src/TransferManager.h');
const manager = read('apps/desktop-qt/src/TransferManager.cpp');
const broker = read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
function body(method) {
  const at = manager.indexOf(`bool TransferManager::${method}(`);
  assert.ok(at >= 0, `bool ${method} exists`);
  const open = manager.indexOf('{', at);
  let level=0;
  for(let i=open;i<manager.length;i++) {
    if(manager[i]==='{') level++;
    if(manager[i]==='}' && --level===0) return manager.slice(open+1,i);
  }
  throw Error(`unbalanced ${method}`);
}
const checks=[];
for(const action of ['pause','resume','retry','cancel','remove','retryAll']) {
  checks.push([`${action} is a bool-returning native method`,header.includes(`Q_INVOKABLE bool ${action}(`)]);
  checks.push([`${action} has a real bool implementation`,manager.includes(`bool TransferManager::${action}(`)]);
}
for(const action of ['pause','resume','cancel']) {
 checks.push([`${action} declines an unsuccessful persistence update`, /if \(!publish\(transferId, entry\)\) return false;/.test(body(action))]);
 checks.push([`${action} confirms success only after the save`,/if \(!publish\(transferId, entry\)\) return false;[\s\S]*?return true;/.test(body(action))]);
}
checks.push(['retry forwards real resume status', /return resume\(transferId\)/.test(body('retry'))]);
checks.push(['cancel refuses a terminal completed transfer', /terminalState\(transferState\(entry\)\)/.test(body('cancel'))]);
checks.push(['remove declines unknown entries', /!m_transfers.contains\(transferId\)\) return false/.test(body('remove'))]);
checks.push(['remove restores entry on failed queue mutation', /m_transfers.insert\(transferId, previous\);[\s\S]*?holdFailedJournalWrite\(\);[\s\S]*?return false;/.test(body('remove'))]);
checks.push(['active remove returns actual cancellation result', /return cancel\(transferId\)/.test(body('remove'))]);
checks.push(['retryAll skips intentionally nonretryable failed entries', /state == QStringLiteral\("failed"\) && entry.value\(QStringLiteral\("retryable"\), true\).toBool\(\)/.test(body('retryAll'))]);
checks.push(['retryAll stops after first uncommitted change', /if \(!resume\(id\)\) return false;/.test(body('retryAll'))]);
checks.push(['retryAll explains partial commit in broker', /some earlier changes may have succeeded/.test(broker)]);
for (const action of ['pause','resume','retry','cancel','remove']) {
  checks.push([`${action} broker stores actual result`,new RegExp(`manager->${action}\\(transferId\\)`).test(broker) && new RegExp(`committed = manager->${action}\\(transferId\\)`).test(broker)]);
}
checks.push(['broker refuses success after failed mutation', /if \(!committed\)[\s\S]*?TRANSFER_QUEUE_MUTATION_UNCOMMITTED[\s\S]*?return QJsonObject\{\{QStringLiteral\("updated"\), true\}\};/.test(broker)]);
checks.push(['retryAll must confirm successful queue mutation', /if \(!manager->retryAll\(\)\)/.test(broker)]);
checks.push(['broker native errors are structured for Desktop rejection', /return fail\(QStringLiteral\("TRANSFER_QUEUE_MUTATION_UNCOMMITTED"\)/.test(broker)]);
for (const [description, pass] of checks) assert.ok(pass,description);
console.log(`${checks.length}/${checks.length} truthful native transfer action acknowledgment contracts passed`);
