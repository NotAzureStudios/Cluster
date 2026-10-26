import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root,rel),'utf8');
let checks=0;
function check(title,fn) {fn();checks++;console.log('PASS',title);}
const apps=path.join(root,'apps/server/src');
function walk(dir) {return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):entry.isFile() && entry.name.endsWith('.ts')?[path.join(dir,entry.name)]:[]);}
const writers=new Set(walk(apps).filter(file=>/\b(?:await\s+)?(?:patchSettings|resetSettingOverrides|saveSettings)\s*\(/.test(fs.readFileSync(file,'utf8'))).map(file=>path.relative(root,file).replaceAll(path.sep,'/')));
// These are *known* call sites, not blanket permission to add new writers.
// Any new Studio writer must be reviewed for CAS or protected publication.
const reviewed=[
 'apps/server/src/app/server-services-settings-integrations.ts',
 'apps/server/src/app/server-routes-configuration-integrations.ts',
 'apps/server/src/app/server-routes-setup.ts',
 'apps/server/src/app/server-routes-context-packs.ts',
 'apps/server/src/domains/admin/admin-tool-routes.ts',
 'apps/server/src/domains/users/team-routes.ts',
 'apps/server/src/domains/auth/studio-security-routes.ts',
 'apps/server/src/domains/integrations/integration-routes.ts',
].sort();
check('Studio setting writer inventory has no unreviewed new source locations',()=>{
 assert.deepEqual([...writers].sort(),reviewed);
});
check('regular Studio Settings API requires per-field loaded-value preconditions',()=>{
 const routes=read('apps/server/src/app/server-routes-configuration-integrations.ts');
 assert(routes.includes('STUDIO_SETTINGS_PRECONDITION_REQUIRED'));
 assert(routes.includes('await patchSettings(safeBody, expectedSettings)'));
 assert(routes.includes('await saveSettings(merged, { changedFields: requestedChanges, expectedSettings })'));
});
check('Tool Config and People settings reject unversioned shared writes',()=>{
 const tools=read('apps/server/src/domains/admin/admin-tool-routes.ts');
 assert(tools.includes('await patchSettings(patch, expected)'));
 assert(tools.includes('await resetSettingOverrides([key], { [key]: body.expectedSetting })'));
 assert(tools.includes('TOOL_CONFIG_STUDIO_CONFIRMATION_REQUIRED'));
 const people=read('apps/server/src/domains/users/team-routes.ts');
 assert(people.includes('await patchSettings({ studioPeopleProfileFields: body.fields }, body.expectedSettings)'));
});
check('configuration import serializes with Studio writes and checks preview under DB lock',()=>{
 const source=read('apps/server/src/app/server-routes-setup.ts');
 assert(source.includes('pg_advisory_xact_lock(506, 1)'));
 assert(source.includes('prepared.previewId !== payload.previewId'));
 const service=read('apps/server/src/app/server-services-settings-integrations.ts');
 assert(service.includes('pg_advisory_xact_lock(506, 1)'));
 assert(service.includes('STUDIO_SETTINGS_CONFLICT'));
});
check('normal Account Settings sends original server fingerprint; narrow clients use field patches',()=>{
 const route=read('apps/server/src/domains/users/user-preference-routes.ts');
 const account=read('packages/renderer/src/features/settings/AccountSettingsPage.tsx');
 assert(route.includes('body.expectedFingerprint !== preferencesFingerprint(fresh)'));
 assert(route.includes('preferencesFingerprint(updated)'));
 assert(account.includes('expectedFingerprint: preferencesFingerprintRef.current'));
 assert(read('packages/renderer/src/features/desktop/DesktopWorkspacePage.tsx').includes('preferences: next'));
});
check('Project inheritance remains allowlisted and version-checked, not a second Studio settings table',()=>{
 const service=read('apps/server/src/domains/admin/project-tool-settings.ts');
 assert(service.includes('projectToolSettingOverride'));
 assert(service.includes('revision: expectedRevision'));
 assert(service.includes('tool: "calendar", field: "defaultView"'));
 assert(!service.includes('calendarEnabled'));
});
console.log(`${checks}/${checks} TD1 writer inventory checks passed`);
