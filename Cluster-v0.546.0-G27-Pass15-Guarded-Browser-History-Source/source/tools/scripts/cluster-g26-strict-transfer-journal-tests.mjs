import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const read = path => readFileSync(new URL('../../'+path, import.meta.url),'utf8');
const manager = read('apps/desktop-qt/src/TransferManager.cpp');
const header = read('apps/desktop-qt/src/TransferManager.h');
const policy = read('apps/desktop-qt/src/DesktopTransferJournalPolicy.h');
const section = (from, to) => manager.slice(manager.indexOf(from), manager.indexOf(to, manager.indexOf(from)+from.length));
const load = section('void TransferManager::load()', 'bool TransferManager::save()');
const validate = section('bool TransferManager::validJournalEntry(', 'bool TransferManager::removeOwnedPartial(');
const cleanup = section('bool TransferManager::removeOwnedPartial(', 'bool TransferManager::reserveQueueEntry(');
const commit = section('void TransferManager::finishDownload(', 'void TransferManager::fail(');
const checks = [
 ['portable metadata policy is independent of Qt headers',!/#include\s*[<"]Q/.test(policy)],
 ['supported directions and states are explicitly enumerated', /validDirection/.test(policy) && /validState/.test(policy)],
 ['journal is bounded before file read', /queueInfo.size\(\) > cluster::desktop::journal::maximumJournalBytes/.test(load)],
 ['malformed entry is rejected before it enters queue', /if \(!value.isObject\(\)\)/.test(load) && /if \(!validJournalEntry\(record\)\)/.test(load)],
 ['invalid entry blocks entire queue not just that row',/if \(!m_queueReadable\) \{\s*m_transfers.clear\(\)/.test(load)],
 ['duplicate IDs remain rejected',/m_transfers.contains\(id\)/.test(load)],
 ['entry validates ID, direction, and state types',/idValue.isString/.test(validate)&&/directionValue.isString/.test(validate)&&/stateValue.isString/.test(validate)],
 ['unknown states and directions are rejected',/validDirection\(direction.toStdString\(\)\)/.test(validate)&&/validState\(state.toStdString\(\)\)/.test(validate)],
 ['entry checks absolute local paths',/QFileInfo\(path\).isAbsolute\(\)/.test(validate)],
 ['byte counts are numeric and checked',/!totalValue.isDouble\(\) || !progressValue.isDouble\(\)/.test(validate)&&/validProgress\(total, transferred\)/.test(validate)],
 ['download journal binds temporary file to its final path',/pairedPartial\(path.toStdString\(\), partial.toString\(\).toStdString\(\)\)/.test(validate)],
 ['download journal binds remote path',/remote.isString\(\)/.test(validate)&&/sameServerApiPath\(remote.toString\(\).toStdString\(\)\)/.test(validate)],
 ['saved expected checksum validated',/validSha256\(expected.toString\(\).toStdString\(\)\)/.test(validate)],
 ['saved commit evidence validated',/validCommitReceipt\(direction.toStdString\(\)/.test(validate)],
 ['upload cannot claim download commit receipt',/record.value\(QStringLiteral\("downloadCommitReceipt"\)\).toBool\(\)/.test(validate)],
 ['journal output also constrained by maximum byte limit',/encoded.size\(\) > cluster::desktop::journal::maximumJournalBytes/.test(manager)],
 ['automatic partial cleanup requires exact path sibling',/pairedPartial\(target.toStdString\(\), partial.toStdString\(\)\)/.test(cleanup)],
 ['cleanup checks current Download folder',/QDir::cleanPath\(QFileInfo\(target\).absolutePath\(\)\) != expectedFolder/.test(cleanup)],
 ['cleanup rejects symlink and non-regular partial',/!file.isFile\(\) \|\| file.isSymLink\(\)/.test(cleanup)],
 ['all cancellation completion paths share protected cleanup',(manager.match(/removeOwnedPartial\(/g)||[]).length === 5],
 ['final network segment is accounted for in durable commit',/entry.insert\(QStringLiteral\("transferredBytes"\), entry.value\(QStringLiteral\("totalBytes"\)\)\)/.test(commit)],
 ['completion still uses two-phase durable publication',(commit.match(/if \(!publish\(id, entry\)\) return;/g)||[]).length === 2],
 ['header declares queue validation',/bool validJournalEntry\(const QJsonObject &record\) const;/.test(header)],
 ['header declares path-bound cleanup',/bool removeOwnedPartial\(const QVariantMap &entry\) const;/.test(header)],
];
for (const [name,ok] of checks) assert.ok(ok,name);
const work=mkdtempSync(join(tmpdir(),'cluster-journal-validation-'));
try {
 const executable=join(work,'policy-test');
 const compile=spawnSync('g++',['-std=c++20','-Wall','-Wextra','-Werror','-pedantic',new URL('../../apps/desktop-qt/tests/transfer_journal_policy_test.cpp',import.meta.url).pathname,'-o',executable],{encoding:'utf8'});
 assert.equal(compile.status,0,`portable journal policy build: ${compile.stderr}`);
 const run=spawnSync(executable,[],{encoding:'utf8'});
 assert.equal(run.status,0,`portable journal policy run: ${run.stderr}`);
 assert.match(run.stdout,/PASS 57 journal recovery admission assertions/);
} finally {rmSync(work,{recursive:true,force:true});}
console.log(`${checks.length+57}/${checks.length+57} strict Desktop journal and cleanup assertions passed`);
