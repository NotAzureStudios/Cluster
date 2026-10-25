import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const qt = readFileSync(new URL('../../apps/desktop-qt/src/TransferManager.cpp', import.meta.url), 'utf8');
const header = readFileSync(new URL('../../apps/desktop-qt/src/DesktopDownloadRangePolicy.h', import.meta.url), 'utf8');
const contracts = [
  ['validated HTTP range controls append admission', /cluster::desktop::download::admit\(/],
  ['resume sends Range', /setRawHeader\(QByteArrayLiteral\("Range"\)/],
  ['strong previous ETag is sent as If-Range', /setRawHeader\(QByteArrayLiteral\("If-Range"\), priorEtag/],
  ['checksum/strong-validator required for retained bytes', /offset > 0 && priorEtag\.isEmpty\(\) && !shaPinned/],
  ['header validation occurs before reading response bytes', /connect\(reply, &QNetworkReply::readyRead,[\s\S]*?validateHeaders\(\);[\s\S]*?if \(!ownsQueue\(\) \|\| !m_downloadHeadersAccepted[\s\S]*?readAll\(\)/],
  ['partial server response issues another continuation', /if \(actual < total\) \{[\s\S]*?runDownload\(id\);/],
  ['total and per-response byte lengths must match', /actual != offset \+ length \|\| actual > total/],
  ['streamed data never exceeds the admitted body length', /chunk\.size\(\) > m_downloadResponseLength - m_downloadResponseWritten/],
  ['trailing data may not exceed the admitted body length', /trailing\.size\(\) <= m_downloadResponseLength - m_downloadResponseWritten/],
  ['destination collision fails without removing another file', /if \(finalFile.exists\(\) \|\| finalFile.isSymLink\(\)\) \{[\s\S]*?!recoveringCommit[\s\S]*?TRANSFER_TARGET_ALREADY_EXISTS/],
  ['no unconditional destination deletion', !/QFile::remove\(targetPath\)/.test(qt)],
  ['pause intent persisted before abort', /bool TransferManager::pause\([\s\S]*?if \(!publish\(transferId, entry\)\) return false;[\s\S]*?if \(m_activeId == transferId && m_activeReply\) m_activeReply->abort\(\)/],
  ['cancel intent persisted before abort', /bool TransferManager::cancel\([\s\S]*?if \(!publish\(transferId, entry\)\) return false;[\s\S]*?if \(active && m_activeReply\) m_activeReply->abort\(\)/],
  ['active cancellation defers deletion until after file close', /if \(interruptedByUser\) \{[\s\S]*?removeOwnedPartial\(transfer\(id\)\)/],
  ['in-flight removal is deferred until safe', /if \(m_activeId == transferId\) \{[\s\S]*?cancel\(transferId\);[\s\S]*?return;[\s\S]*?m_transfers\.remove/],
  ['background checksum callback respects canceled state', (qt.match(/m_activeId != id \|\| transferState\(transfer\(id\)\) != QStringLiteral\("verifying"\)/g) || []).length === 2],
  ['failure of resume never truncates retained bytes', !/m_activeFile->resize\(0\)/.test(qt)],
  ['all seven upload callbacks fence canceled or paused replies', (qt.match(/if \(discardInterruptedReply\(id, reply\)\) return;/g) || []).length === 7],
  ['interrupted upload callbacks cannot resurrect a canceled transfer', /bool TransferManager::discardInterruptedReply\([\s\S]*?state != QStringLiteral\("cancelled"\)[\s\S]*?m_activeId.clear\(\)/],
  ['standalone native range policy has no Qt dependency', !/#include <Q/.test(header)],
  ['tiny repeated ranges have explicit error feedback', /admission.rejection == Reject::fragmentTooSmall/],
];
let passed = 0;
for (const [label, test] of contracts) {
  assert.ok(test instanceof RegExp ? test.test(qt) : test, label);
  passed += 1;
}
const work = mkdtempSync(join(tmpdir(), 'cluster-qt-range-'));
try {
  const executable = join(work, 'range-test');
  const source = new URL('../../apps/desktop-qt/tests/download_range_policy_test.cpp', import.meta.url).pathname;
  const build = spawnSync('g++', ['-std=c++20', '-Wall', '-Wextra', '-Werror', '-pedantic', source, '-o', executable], { encoding:'utf8' });
  assert.equal(build.status, 0, `portable C++ range policy compile: ${build.stderr}`);
  const run = spawnSync(executable, [], { encoding:'utf8' });
  assert.equal(run.status, 0, `portable C++ range policy tests: ${run.stderr}`);
  assert.match(run.stdout, /PASS 35 native range-policy assertions/);
  passed += 35;
} finally {
  rmSync(work, { recursive:true, force:true });
}
console.log(`${passed}/${passed} Qt download continuity source + compiled policy assertions passed`);
