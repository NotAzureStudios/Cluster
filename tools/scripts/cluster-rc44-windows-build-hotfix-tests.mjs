// RC44 Windows renderer build regression tests for reported compiler failures.
// These checks are not a substitute for an installed, dependency-backed TypeScript build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = (() => {
  try { return require('typescript'); }
  catch { return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
})();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = (relative) => fs.readFileSync(path.join(root,relative),'utf8');
const wb = source('packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx');
const systems = source('packages/renderer/src/features/admin/OperationsSystemsPanel.tsx');
const release = JSON.parse(source('config/release-candidate.json'));
let count=0;
function check(label,fn) { fn(); console.log(`PASS ${++count}: ${label}`); }
function bodyAfter(s,needle,endNeedle) {
  const start=s.indexOf(needle); assert(start>=0,`Missing ${needle}`);
  const end=s.indexOf(endNeedle,start+needle.length); assert(end>start,`Missing boundary for ${needle}`);
  return s.slice(start,end);
}
check('RC44 is a newer managed installer candidate and preserves source version',()=>{
  assert(release.sequence>=44);
  assert.equal(release.channel,'stable');
  assert.match(release.release,/^1\.0\.[1-9][0-9]*$/);
  assert.equal(release.release,release.sourceVersion);
});
check('Whiteboard draft is based on editable whiteboard state, not undefined function arguments',()=>{
  const body=bodyAfter(wb,'function currentWhiteboardDraft(', 'function applyWhiteboardWorkingCopy(');
  assert.match(body,/name:\s*whiteboardName\.trim\(\)\s*\|\|\s*"Untitled Whiteboard"/);
  assert.doesNotMatch(body,/nameOverride/);
});
check('New whiteboard modal includes required accessible message',()=>{
  const body=bodyAfter(wb,'async function createNamedWhiteboard()', 'async function createWhiteboard(');
  assert.match(body,/promptCluster\(\{\s*title:\s*"New whiteboard",\s*message:\s*"[^"]+"/);
  assert.match(body,/await createWhiteboard\(name\)/);
});
check('Whiteboard creation payload respects the prompted name override',()=>{
  const body=bodyAfter(wb,'async function createWhiteboard(nameOverride?: string)', 'async function saveWhiteboard(');
  assert.match(body,/name:\s*nameOverride\?\.trim\(\)\s*\|\|\s*whiteboardName\.trim\(\)/);
  assert.match(body,/api<Whiteboard>\("\/api\/whiteboards"/);
});
check('Whiteboard create button does not pass a mouse event as a name override',()=>{
  assert.match(wb,/onClick=\{activeWhiteboard\s*\?\s*\(\)\s*=>\s*void saveWhiteboard\(\)\s*:\s*\(\)\s*=>\s*void createWhiteboard\(\)\}/);
  assert.doesNotMatch(wb,/onClick=\{activeWhiteboard\s*\?\s*[^:]+:\s*createWhiteboard\}/);
});
check('All Whiteboard action surfaces invoke creation without passing an event payload',()=>{
  assert.equal((wb.match(/onCreate=\{\(\)\s*=>\s*void createWhiteboard\(\)\}/g)||[]).length,3);
  assert.doesNotMatch(wb,/onCreate=\{createWhiteboard\}/);
});
check('Operations only renders media worker meter after confirming both measurements exist',()=>{
  assert.match(systems,/typeof mediaWorkersOnline === "number"\s*&&\s*typeof mediaWorkersTotal === "number"\s*&&\s*<ClusterVisualMeter/);
  assert.doesNotMatch(systems,/snapshot\.media\.workers\.total\s*>/);
});
check('Both edited TSX files have no parser diagnostics',()=>{
  for (const [label,code] of [['whiteboard',wb],['operations',systems]]) {
    const ast=ts.createSourceFile(`${label}.tsx`,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    assert.equal(ast.parseDiagnostics.length,0,`${label} parsing: ${ast.parseDiagnostics.map(d=>d.messageText).join('; ')}`);
  }
});
console.log(`RC44 Windows build hotfix checks ${count}/${count} passed. Full TS build unverified.`);
