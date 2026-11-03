import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import net from 'node:net';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const root=path.resolve(import.meta.dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const modulePath='apps/server/src/core/server-network-change-review.ts';
const js=ts.transpileModule(read(modulePath),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};
vm.runInNewContext(js,{exports,require:id=>{if(id==='node:net')return net;throw Error('unexpected dependency '+id)},URL,JSON,Number,Boolean,String,Error,Map,Object,Array}, {filename:modulePath});
const {reviewNetworkChange,reviewBoundDomainPortDrift,NETWORK_REVIEW_KEYS}=exports;
let n=0;
function ok(v,message){assert.ok(v,message);n++}
function eq(a,b,message){assert.equal(a,b,message);n++}
function code(result,id){return result.blockers.some(x=>x.code===id)}
function warn(result,id){return result.warnings.some(x=>x.code===id)}
const defaults={serverHost:'127.0.0.1',serverPort:4100,webHost:'127.0.0.1',webPort:3000,publicApiUrl:'http://127.0.0.1:4100',publicWebUrl:'http://127.0.0.1:3000',sessionSecure:false, trustedProxy:false,corsOrigins:'http://127.0.0.1:3000'};
const run=changes=>reviewNetworkChange(defaults,changes);
let r=run({});ok(r.ok,'local defaults safe');eq(r.editedKeys.length,0,'no false dirty fields');ok(!r.requiresRestart,'unchanged does not require restart');
r=reviewNetworkChange({},{});eq(r.editedKeys.length,0,'missing optional boot defaults are not edited');
r=run({webPort:3200});ok(r.ok,'new port allowed');ok(r.requiresRestart,'port restart');ok(warn(r,'RESTART_REQUIRED'),'restart warning');
for(const invalid of [0,-1,65536,2.5,NaN,null,'4000']){r=run({serverPort:invalid});ok(code(r,'INVALID_TCP_PORT'),'invalid API port rejected '+invalid)}
for(const invalid of [0,65536,NaN,null,'3000']){r=run({webPort:invalid});ok(code(r,'INVALID_TCP_PORT'),'invalid web port rejected '+invalid)}
r=run({webPort:4100});ok(code(r,'PORT_COLLISION'),'same API and web port');
r=run({serverPort:54321});ok(code(r,'POSTGRESQL_PORT_COLLISION'),'postgres private port cannot host API');
r=run({webPort:54321});ok(code(r,'POSTGRESQL_PORT_COLLISION'),'postgres private port cannot host web');
r=run({serverHost:'0.0.0.0'});ok(code(r,'API_MUST_BE_PRIVATE'),'public api bind forbidden');
r=run({serverHost:'192.168.1.1'});ok(code(r,'API_MUST_BE_PRIVATE'),'lan api bind forbidden');
r=run({serverHost:'bad hostname'});ok(code(r,'INVALID_API_BIND'),'ambiguous host forbidden');
r=run({serverHost:'::1'});ok(r.ok,'ipv6 private bind accepted');
r=run({serverHost:'127.0.0.2'});ok(r.ok,'127/8 loopback bind accepted');
r=run({webHost:'mydns.local'});ok(code(r,'INVALID_WEB_BIND'),'dns name bind rejected');
r=run({webHost:'0.0.0.0'});ok(code(r,'REMOTE_TLS_REQUIRED'),'public web bind requires direct TLS');ok(warn(r,'GATEWAY_EXPOSED'),'public bind visible');ok(r.requiresExposureConfirmation,'dangerous bind requires confirmation');eq(r.exposure.windowsFirewall,'not_checked','do not claim firewall verification');
r=run({webHost:'192.168.1.88',publicWebUrl:'http://192.168.1.88:3000',allowInsecureLanHttp:true});ok(r.ok,'explicit private LAN HTTP admitted');ok(warn(r,'LAN_HTTP_RISK'),'LAN credential transport warned');
r=run({webHost:'0.0.0.0',publicWebUrl:'http://cluster.example.com',allowInsecureLanHttp:true});ok(code(r,'INSECURE_LAN_NOT_PRIVATE'),'wildcard HTTP rejected');
r=run({webHost:'192.168.1.88',publicWebUrl:'https://cluster.example.com',webTlsCertFile:'cert.pem',webTlsKeyFile:'key.pem',sessionSecure:true});ok(r.ok,'native HTTPS listener admitted');
r=run({webHost:'192.168.1.88',publicWebUrl:'https://cluster.example.com',sessionSecure:true});ok(code(r,'REMOTE_TLS_REQUIRED'),'remote HTTPS without native certificate rejected');
r=run({webHost:'192.168.1.88',trustedProxy:true});ok(code(r,'PUBLIC_PROXY_HEADER_TRUST'),'direct exposure plus proxy-trust forbidden');
r=run({trustedProxy:true});ok(r.ok,'proxy trust with loopback gateway allowed');
r=run({publicWebUrl:'https://cluster.example.com',sessionSecure:false});ok(code(r,'HTTPS_REQUIRES_SECURE_COOKIE'),'external https requires secure cookies');
r=run({publicWebUrl:'https://cluster.example.com',sessionSecure:true,corsOrigins:'https://cluster.example.com'});ok(r.ok,'external https with secure cookie accepted');
r=run({publicApiUrl:'http://cluster.example.com'});ok(warn(r,'PUBLIC_HTTP'),'public HTTP warning');ok(r.requiresExposureConfirmation,'public HTTP confirmation');
r=run({publicWebUrl:'https://username:password@cluster.example.com',sessionSecure:true});ok(code(r,'INVALID_PUBLIC_ORIGIN'),'credentials rejected');
r=run({publicWebUrl:'https://cluster.example.com/health',sessionSecure:true});ok(code(r,'INVALID_PUBLIC_ORIGIN'),'path rejected');
r=run({publicWebUrl:'https://cluster.example.com?q=a',sessionSecure:true});ok(code(r,'INVALID_PUBLIC_ORIGIN'),'query rejected');
r=run({publicWebUrl:'https://cluster.example.com/#token',sessionSecure:true});ok(code(r,'INVALID_PUBLIC_ORIGIN'),'fragment rejected');
r=run({publicWebUrl:'javascript:alert(1)'});ok(code(r,'INVALID_PUBLIC_ORIGIN'),'non-http rejected');
r=run({publicWebUrl:'http://localhost:3000'});ok(r.ok,'local http accepted');
r=run({publicWebUrl:'https://cluster.example.com',sessionSecure:true});ok(warn(r,'PUBLIC_WEB_CORS'),'cors mismatch warning');
r=run({corsOrigins:'https://user:secret@host.example'});ok(code(r,'INVALID_CORS_ORIGIN'),'credential-bearing cors origin rejected');
r=run({corsOrigins:'*'});ok(code(r,'INVALID_CORS_ORIGIN'),'wildcard cors rejected');
r=run({lanDiscoveryEnabled:true,webHost:'0.0.0.0'});ok(warn(r,'LAN_DISCOVERY'),'lan discovery exposure explained');
r=run({webPort:80});ok(warn(r,'PRIVILEGED_PORT'),'reserved port warning');
r=reviewNetworkChange(defaults,{webPort:3200},{managedPrivatePostgresPort:3200});ok(code(r,'POSTGRESQL_PORT_COLLISION'),'custom managed PostgreSQL port conflict');
const domains=reviewBoundDomainPortDrift([
  {id:'00000000-0000-4000-8000-000000000001',connectionWebPort:3000,connectionApiPort:4100},
  {id:'00000000-0000-4000-8000-000000000002',connectionWebPort:3000,connectionApiPort:4100},
],{webPort:3200,serverPort:4100});
eq(domains.checked,2,'bound-domain count');
eq(domains.mismatches.length,2,'both bound-domain profiles drift');
ok(domains.mismatches.every(x=>x.webPortMismatch&&!x.apiPortMismatch),'API unchanged, gateway changed');
eq(reviewBoundDomainPortDrift([],{}).checked,0,'no bound domains');
const originNoSecrets=run({publicWebUrl:'https://user:password@cluster.example.com'});
ok(!JSON.stringify(originNoSecrets).includes('password'),'preview never returns secrets');
const limited=run({webHost:'local.invalid'});ok(!limited.ok,'invalid changes fail closed');
// Route + UI integration contracts ensure the real PUT path also validates drafts.
const routes=read('apps/server/src/app/server-routes-configuration-integrations.ts');
const ui=read('packages/renderer/src/features/settings/ServerConfigPage.tsx');
ok(routes.includes('app.post("/api/server-config/network/preview"'),'admin-only route registered');
ok(routes.includes('NETWORK_CONFIG_UNSAFE'),'backend refuses blocker');
ok(routes.includes('reviewNetworkChange(existing as Record<string, unknown>, merged as Record<string, unknown>)'),'PUT rechecks merged settings');
ok(routes.includes('CONFIRM NETWORK EXPOSURE'),'explicit typed exposure confirmation');
const nativeLauncher=read('apps/server-launcher-go/main.go');
ok(nativeLauncher.includes('"--api-port", fmt.Sprint(network.PublicAPIPort)'),'saved API port actually forwarded to native Host');
ok(nativeLauncher.includes('"--allow-remote"'),'explicit non-loopback bindings forwarded with Host TLS guard');

ok(routes.includes('reviewBoundDomainPortDrift(profiles.slice(0, 25), draft)'),'bounded domain profile comparison');
ok(routes.includes('bindingServerInstanceId: serverId'),'profile comparison restricted to local server');
ok(routes.includes('private, no-store'),'not cached');
ok(routes.includes('verifyUserPin(user, securityPin, "apply_server_configuration", request)'),'one protected save PIN');
ok(ui.includes('Review network changes'),'UI wired');
ok(ui.includes('networkReview.fingerprint === JSON.stringify(networkDraft())'),'stale previews hidden');
ok(ui.includes('Only the independent Windows Service can verify or automatically restore a staged rollout'),'rollback claim explicitly limited to managed service');
console.log(`Cluster F2 P5 Network & Ports policy: ${n}/${n} assertions passed`);
