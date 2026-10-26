import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(read('packages/renderer/src/features/notifications/notification-mandatory-security.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports });
const { isMandatorySecurityNotification } = module.exports;
let n = 0;
for (const [x, expected] of [
  [{ category: 'system', signal: 'security', priority: 'critical' }, true],
  [{ category: 'system', signal: 'security', priority: 'high' }, false],
  [{ category: 'system', signal: 'activity', priority: 'critical' }, false],
  [{ category: 'work', signal: 'security', priority: 'critical' }, false],
  [null, false],
  [{}, false],
]) { assert.equal(isMandatorySecurityNotification(x), expected); n++; }
const inbox = read('packages/renderer/src/features/notifications/NotificationInboxPage.tsx');
const tabs = read('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
for (const s of [inbox, tabs]) { assert.match(s, /isMandatorySecurityNotification\(item\) && !notificationCategoryEnabled/); n++; }
const server = read('apps/server/src/domains/notifications/notification-policy.ts');
assert.match(server, /input\.category === "system" && input\.signal === "security" && priority === "critical"/); n++;
console.log(`${n}/${n} G27 P52 mandatory security visibility checks passed`);
