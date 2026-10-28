/** Regression evidence for RC2 renderer compile-boundary repairs.
 * This is structural contract coverage, NOT a substitute for dependency-backed tsc.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(root, 'packages/renderer/src', file), 'utf8');
const checks = [
  ['analytical view imports the canonical input and toolbar', () => /import \{ ClusterTextInput \} from "\.\/ClusterTextInput"/.test(read('components/DataView.tsx')) && /import \{ ClusterToolbar \} from "\.\/ClusterToolbar"/.test(read('components/DataView.tsx'))],
  ['native Qt and Desktop renderer agree on added capabilities', () => {
    const broker = fs.readFileSync(path.join(root, 'apps/desktop-qt/src/NativeCapabilityBroker.cpp'), 'utf8');
    const renderer = read('core/desktop.ts');
    return ['package.auditFiles', 'package.transfer.stage', 'package.msiIncidentWorklist', 'package.msiRollbackCascade'].every((value) => broker.includes(`QStringLiteral("${value}")`) && renderer.includes(`| "${value}"`));
  }],
  ['Desktop event profile context is discriminated before access', () => read('core/desktop.ts').includes('"profileId" in event && event.profileId')],
  ['Desktop transfer recovery checks refused union separately', () => read('core/desktop.ts').includes('if ("accepted" in result) return result;')],
  ['SHA-256 browser digest accepts owned ArrayBuffer-backed bytes', () => read('core/desktop.ts').includes('new Uint8Array(prefix)') && read('core/desktop.ts').includes('new Uint8Array(bytes)')],
  ['offline Web Locks flatten their async result', () => read('core/offline-storage.ts').includes('async function withReadScopeOperation<T>') && read('core/offline-storage.ts').includes('return await locks.request(')],
  ['post-commit avatar/profile presentation callbacks are promise-returning', () => read('features/settings/AccountSettingsPage.tsx').includes('reconcileAfterCommit(async () => onUserUpdated(result.user))')],
  ['account setting optimistic response includes the revision fingerprint', () => read('features/settings/AccountSettingsPage.tsx').includes('optimisticResult: { ...optimisticPreferenceResult, fingerprint:')],
  ['application foundation exposes shared appearance runtime', () => read('features/application/modules/application-foundation.tsx').includes('export { applyCustomization } from "./application-shell-runtime"')],
  ['board create fallback satisfies the complete Card model', () => read('features/boards/BoardWorkspaceDialogs.tsx').includes('checklistItems: [], comments: [] } satisfies Card')],
  ['Library job-state callbacks guard existing server job identity', () => read('features/library/LibraryWorkspacePage.tsx').includes('current && current.id === id ?')],
  ['Calendar recurrence button gate resolves to boolean', () => read('features/calendar/CalendarPage.tsx').includes('Boolean(recurrenceRule)')],
  ['resource navigation validates recipient records and null catalogs', () => read('features/workflow/authorized-packet-navigation.ts').includes('(result as PacketCatalogRead)?.packets') && read('features/workflow/authorized-packet-navigation.ts').includes('Array.isArray(records)')],
  ['studio production profile classification matches shared authority', () => read('features/settings/StudioSettingsPage.tsx').includes('profile.classification === "specialized"')],
  ['RC smoke source scanner is cross-platform', () => !readSourceScan().includes("require('/opt/nvm/") && readSourceScan().includes("require('typescript')")],
];
function readSourceScan() { return fs.readFileSync(path.join(root, 'tools/scripts/cluster-td6-source-scan.mjs'), 'utf8'); }
let passed = 0;
for (const [label, test] of checks) { assert.ok(test(), label); console.log('PASS ' + label); passed++; }
console.log(`${passed}/${checks.length} RC2 renderer-boundary source checks passed (not a full TypeScript build)`);
