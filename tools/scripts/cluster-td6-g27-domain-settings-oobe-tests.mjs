import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
let ts;
try {ts = require('typescript');} catch {ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');}
const root = new URL('../../',import.meta.url);
function source(name) { return fs.readFileSync(new URL(name,root),'utf8'); }
function load(name, mocks) {
  const js = ts.transpileModule(source(name), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports:{}};
  vm.runInNewContext(js, {module,exports:module.exports,require:id=> {if (!(id in mocks)) throw Error(`Unexpected import ${id}`);return mocks[id];},Object,Number,Boolean,String,Promise,Date,JSON,Error}, {filename:name});
  return module.exports;
}
const plans = load('apps/server/src/domains/domains/domain-connection-plans.ts',{});
const deployment = load('apps/server/src/domains/domains/domain-deployment-readiness.ts',{'node:crypto':{createHash},'./domain-connection-plans.js':plans});
const hostname = 'cluster.azurestudios.dev';
const caddy = {mode:'direct_https', provider:'caddy', webPort:3000,apiPort:4000,publicPort:443};
const valid = {publicWebUrl:`https://${hostname}`, publicApiUrl:`https://${hostname}`, corsOrigins:`https://${hostname}`,
  webPort:3000,serverPort:4000,sessionSecure:true,trustedProxy:true,webHost:'127.0.0.1',serverHost:'127.0.0.1'};
let checks = 0;
const ok = (value,label) => {assert.ok(value,label);checks++;};
const eq = (value,expected,label) => {assert.equal(value,expected,label);checks++;};
const ready = deployment.domainDeploymentReadiness(hostname,caddy,valid);
eq(ready.configured,true,'complete settings match');
eq(ready.gatewayInstalled,'not_verified','not deployed');
ok(ready.checks.every(c=>c.pass),'all checks pass');
for(const [field,value] of [['publicWebUrl','http://cluster.azurestudios.dev'],['webPort',8080],['corsOrigins','https://evil.example'],['sessionSecure',false],['trustedProxy',false],['serverHost','0.0.0.0'],['webHost','0.0.0.0']]) {
  const result=deployment.domainDeploymentReadiness(hostname,caddy,{...valid,[field]:value});
  eq(result.configured,false,`mismatch ${field} denied`);
}
const bundle=deployment.domainDeploymentBundle({domainId:'id-1',revision:8,hostname,profile:caddy,instanceId:'server-1'});
eq(bundle.schemaVersion,1,'schema version');
eq(bundle.deploymentState,'requires_operator_review','no activation claim');
eq(bundle.revision,8,'pins revision');
const {sha256,digestContract,...payload}=bundle;
eq(createHash('sha256').update(JSON.stringify(payload)).digest('hex'),sha256,'manifest digest covers actual payload');
ok(bundle.artifacts.some(a=>a.filename==='Caddyfile'),'includes real config');
ok(!JSON.stringify(bundle).includes('BEGIN PRIVATE KEY'),'no key material');
const studio=source('packages/renderer/src/features/settings/StudioSettingsPage.tsx');
const server=source('packages/renderer/src/features/settings/ServerConfigPage.tsx');
const vault=source('packages/renderer/src/features/inventory/InventoryWorkspacePage.tsx');
const setup=source('packages/renderer/src/features/application/modules/ApplicationSetupWizard.tsx');
const setupServer=source('apps/server/src/app/server-routes-setup.ts');
ok(studio.includes('<StudioDomainsPanel />'),'Studio owns domain registry');
ok(server.includes('<ServerDomainsPanel />'),'Server Config owns gateway');
ok(!vault.includes('<DomainInventoryPanel />') && !vault.includes('<VaultDomainsPanel />') && source('packages/renderer/src/features/application/modules/ApplicationSidebar.tsx').includes('{ label: "Domains"'), 'Domains is a dedicated Admin destination, not a Vault panel');
ok(setup.includes('"Domain & Access"') && setup.includes('domainSetupIntent'),'OOBE owns initial domain intent');
ok(source('packages/renderer/src/features/admin/AdminSetupChecklist.tsx').includes('<DomainSetupContinuation '),'authenticated OOBE completion is available');
ok(setupServer.includes('domainSetupIntent: z.object') && setupServer.includes('Unsupported domain connection mode/provider'),'bootstrap validates input');
const domainRegistry=source('apps/server/src/domains/domains/domain-management-routes.ts');
const domainRoutes=source('apps/server/src/domains/domains/domain-connection-routes.ts');
ok(!domainRegistry.includes('/api/admin/vault/domains'),'canonical domain registration route');
ok(!domainRoutes.includes('/api/admin/vault/domains'),'canonical server routing route');
ok(domainRoutes.includes('/api/admin/domains/setup-intent'),'admin-only OOBE handoff');
ok(domainRoutes.includes('/deployment/readiness') && domainRoutes.includes('/deployment/bundle'),'readiness and package endpoints');
console.log(`G27 Domain OOBE, settings and deployment: ${checks}/${checks} checks passed`);
