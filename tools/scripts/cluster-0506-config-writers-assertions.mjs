import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js')); } })();
const file = (x) => fs.readFileSync(x,'utf8');
const service = file('apps/server/src/app/server-services-settings-integrations.ts');
const policy = file('apps/server/src/domains/auth/studio-security-routes.ts');
const integration = file('apps/server/src/domains/integrations/integration-routes.ts');
const packs = file('apps/server/src/app/server-routes-context-packs.ts');
const app = file('apps/server/src/app/cluster-server.ts');
const authTypes = file('apps/server/src/domains/auth/auth-types.ts');
const helperSrc = file('apps/server/src/core/server-config-preconditions.ts');
const sandbox = {module:{exports:{}}, exports:{}}; sandbox.exports=sandbox.module.exports;
vm.runInNewContext(ts.transpileModule(helperSrc,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,sandbox);
const {checkServerConfigPreconditions,expectedServerConfigFields} = sandbox.module.exports;
let passed = 0, total = 0;
function check(label, test) { total++; try { test(); passed++; console.log(`PASS ${label}`); } catch (e) { console.error(`FAIL ${label}: ${e.stack}`); process.exitCode=1; } }

check('field preconditions track actual existence and null separately', () => {
 const expected=expectedServerConfigFields({name:'Cluster',empty:null},{name:'Updated',empty:'x',missing:false});
 assert.deepEqual(JSON.parse(JSON.stringify(expected)),{name:{exists:true,value:'Cluster'},empty:{exists:true,value:null},missing:{exists:false}});
 assert.deepEqual(Array.from(checkServerConfigPreconditions({name:'Cluster',empty:null},{name:'Updated',empty:'x',missing:false},expected).conflicts),[]);
});
check('field preconditions detect intervening edits without losing unrelated changes', () => {
 const expected=expectedServerConfigFields({name:'A'},{name:'B'});
 assert.deepEqual(Array.from(checkServerConfigPreconditions({name:'C',unrelated:88},{name:'B'},expected).conflicts),['name']);
});
check('field preconditions reject prototype pollution keys',()=>{assert.throws(()=>expectedServerConfigFields({},JSON.parse('{"__proto__":1}')))});
check('security policy does not write a stale whole-settings snapshot',()=>{
 assert.match(policy,/const changes = \{/);
 assert.doesNotMatch(policy,/const nextSettings = \{\s*\.\.\.settings/);
 assert.match(policy,/await saveSettings\(\{\}, \{\s*changedFields: changes,/);
 assert.match(policy,/expectedServerConfigFields\(settingsForClient\(settings\), changes\)/);
});
check('security policy preserves live MFA policy enforcement and 409 conflicts',()=>{
 assert.match(policy,/MFA_POLICY_BOOTSTRAP_REQUIRED/);
 assert.match(policy,/revokeSessionsOutsideMfaPolicy\(body, session\)/);
 assert.match(policy,/error\?\.code === "SERVER_CONFIG_CONFLICT"/);
});
check('Discord publishes only the named provider-owned keys',()=>{
 assert.match(integration,/const changes: SettingPayload = \{/);
 assert.doesNotMatch(integration,/const nextSettings: SettingPayload = \{\s*\.\.\.existingSettings/);
 assert.match(integration,/await input\.saveSettings\(\{\}, \{/);
});
check('Discord secrets are optional writes with explicit clear',()=>{
 for (const name of ['ApplicationPublicKey','BotToken','Webhook']) assert.match(integration,new RegExp('if \\(body\\.clear'+name+'\\) changes\\.discord'));
 assert.doesNotMatch(integration,/discordBotToken: .*existingSettings\.discordBotToken/);
});
check('Discord uses actual server preconditions and 409 on contention',()=>{
 assert.match(integration,/expectedServerConfigFields\(input\.settingsForClient\(existingSettings\), changes\)/);
 assert.match(integration,/SERVER_CONFIG_CONFLICT/);
});
const namedRoutes = [
 ['GET','/api/context-packs'],['POST','/api/context-packs/import'],
 ['GET','/api/context-packs/:packId/export'],['POST','/api/context-packs/:packId/secret-export'],['POST','/api/context-packs/:packId/apply'],['DELETE','/api/context-packs/:packId'],
];
check('both settings-creation routes use the common explicit admin gate',()=>{
 assert.match(packs,/async function createFromSettings\(.*?\) \{\s*const admin = await authorization\.requireAdmin\(request, reply\);\s*if \(!admin\) return;/);
 assert.match(packs,/app\.post\("\/api\/context-packs\/from-settings", \(request, reply\) => createFromSettings\(request, reply, false\)\)/);
 assert.match(packs,/app\.post\("\/api\/context-packs\/from-settings-with-secrets", \(request, reply\) => createFromSettings\(request, reply, true\)\)/);
});
for (const [method,url] of namedRoutes) {
 check(`${method} ${url} requires explicit admin`,()=>{
  const pattern=new RegExp(`app\\.${method.toLowerCase()}\\("${url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}", async \\(request, reply\\) => \\{\\s*const admin = await authorization\\.requireAdmin\\(request, reply\\);\\s*if \\(!admin\\) return;`);
  assert.match(packs,pattern);
 });
}
check('Context Pack export forbids caching and uses an admin route',()=>{
 assert.match(packs,/Cache-Control", "no-store"/);
 assert.match(packs,/serializeContextPack\(pack, true\)/);
});
check('Context Pack apply uses only existing allowlisted field projection',()=>{
 assert.match(packs,/const changes = pickContextPackSettings\(payload\)/);
 assert.match(packs,/await saveSettings\(\{\}, \{/);
 assert.doesNotMatch(packs,/saveSettings\(\{ \.\.\.existing, \.\.\.pickContextPackSettings/);
});
check('Context Pack apply rejects empty changes and stale edits',()=>{
 assert.match(packs,/CONTEXT_PACK_EMPTY/);
 assert.match(packs,/expectedServerConfigFields\(settingsForClient\(existing\), changes\)/);
 assert.match(packs,/SERVER_CONFIG_CONFLICT/);
});
check('secret rotation is not triggered by a read',()=>{
 const readBody=service.slice(service.indexOf('  async function readSettings('),service.indexOf('  async function mutateSettingsKeys('));
 assert.doesNotMatch(readBody,/await persistDatabaseSettings\(merged\)/);
 assert.doesNotMatch(readBody,/await writeConfigFileSettings\(merged\)/);
 assert.doesNotMatch(readBody,/rotateContextPackEncryption\(\)/);
});
check('explicit key rewrap takes the publication locks and current truth',()=>{
 assert.match(service,/if \("rewrapOnly" in options\)/);
 assert.match(service,/next = \{ \.\.\.current, appDisplayName: "Cluster" \}/);
 assert.match(service,/await saveSettings\(\{\}, \{ rewrapOnly: true \}\)/);
 assert.match(service,/storageSecretRotationPromise = rotateContextPackEncryption\(\)/);
 assert.match(service,/pg_advisory_xact_lock\(506, 1\)/);
 assert.match(service,/pg_advisory_xact_lock\(506, 2\)/);
});
check('sensitive key rewrap route delegates and does not use a pre-read snapshot',()=>{
 assert.match(policy,/await rewrapProtectedSettings\(\)/);
 assert.doesNotMatch(policy,/await saveSettings\(settings\)/);
 assert.match(policy,/requireConfirmation\(request, reply, "REWRAP SECRETS"\)/);
});
check('route dependency wiring passes safe projections and rewrap authority',()=>{
 assert.match(app,/registerIntegrationRoutes\(\{[^\n]+settingsForClient,/);
 assert.match(app,/const providerRouteDeps = \{\s*app,\s*authorization,/);
 assert.match(authTypes,/rewrapProtectedSettings: \(\) => Promise<void>/);
});
check('legacy direct file writer is absent',()=>{
 assert.doesNotMatch(service,/async function writeConfigFileSettings/);
 assert.match(service,/await prepareConfigPublication\(CONFIG_FILE_PATH, afterBytes\)/);
});
console.log(`${passed}/${total} config-writer convergence assertions passed`);
if (process.exitCode || passed!==total) process.exitCode=1;
