import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const postcss = require('postcss');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(root,file),'utf8');
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const files = [
  'packages/renderer/src/components/ClusterPinEntry.tsx',
  'packages/renderer/src/components/SecurityPinHost.tsx',
  'packages/renderer/src/features/desktop/SignedOutKioskPage.tsx',
  'packages/renderer/src/features/admin/OperationsIncidentsPanel.tsx',
  'packages/renderer/src/features/application/modules/ApplicationSetupWizard.tsx',
  'packages/renderer/src/core/security-pin.ts',
  'apps/server/src/app/server-routes-setup.ts',
];
for (const name of files) {
  const text = read(name);
  const parsed = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  check(parsed.parseDiagnostics.length === 0, `${name}: syntax errors`);
}
for (const name of ['packages/renderer/src/components/cluster-pin-entry.css','packages/renderer/src/components/security-pin.css','packages/renderer/src/features/desktop/signed-out-kiosk.css']) {
  check(postcss.parse(read(name), { from:name }).nodes.length > 0, `${name}: invalid CSS`);
}
const pin = read(files[0]);
const host = read(files[1]);
const kiosk = read(files[2]);
const ops = read(files[3]);
const setup = read(files[4]);
const server = read(files[6]);
check(pin.includes('inputMode="numeric"') && pin.includes('onChange(value.slice(0, -1))'), 'shared PIN accepts physical keyboard and delete');
check(pin.includes('role="group" aria-label="PIN keypad"'), 'keypad accessible to assistive technology');
check(pin.includes('min-height') === false, 'keypad height controlled by CSS, not JS');
check(pin.includes('value.slice(0, -1)') && pin.includes('value + digit'), 'keypad supports append and backspace');
check(pin.includes('disabled={disabled || value.length >= 8}'), 'keypad blocks ninth digit');
check(host.includes('<ClusterPinEntry') && host.includes('portal={true}'), 'main modal uses reusable keypad and body portal');
check(!host.includes('security-pin-step-v267') && !host.includes('phaseCopy.helper'), 'no redundant step/helper text');
check(host.includes('mode !== "verify"') && host.includes('phaseCopy.label'), 'setup and change modes retain necessary context');
check(kiosk.includes('<ClusterPinEntry value={credential}') && kiosk.includes('credentialType === "pin"'), 'signed-out admin PIN has a real keypad');
check(kiosk.includes('"/api/kiosk/admin-exit"'), 'kiosk still uses signed-out authorization route');
check(kiosk.includes('/^\\d{4,8}$/'), 'kiosk PIN length checked before submit');
check(ops.includes('requestSecurityPin(') && ops.includes('requestSecurityPinSetup('), 'operations uses shared PIN for existing and new accounts');
check(!ops.includes('alertPin') && ops.includes('securityPin: pin'), 'no persistent inline PIN field for operations');
check(setup.includes('ownerPinConfirm') && setup.includes('ownerPin: form.ownerPin'), 'owner chooses and confirms PIN at setup');
check(setup.includes('form.ownerPin === form.ownerPinConfirm'), 'owner confirmation must match');
check(server.includes('ownerPin: z.string().regex(/^\\d{4,8}$/'), 'server requires PIN at owner bootstrap');
check(server.includes('hashSecurityPin(body.ownerPin)'), 'server hashes Owner PIN before account write');
check((server.match(/pinHash: ownerPinHash,/g) || []).length === 2, 'both Owner bootstrap create and update persist hashed PIN');
check(!server.includes('pinHash: body.ownerPin'), 'raw PIN not persisted to database');
check(read('packages/renderer/src/components/security-pin.css').includes('overflow-y: auto'), 'compact modal remains usable on short screens');
console.log(`RC24 PIN setup and reduced-copy checks: ${checks}/${checks} passed`);
