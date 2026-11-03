import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = new URL('../../apps/server/src/domains/domains/', import.meta.url);
function load(name, mods) {
  const src = fs.readFileSync(new URL(name, root), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: id => { if (!(id in mods)) throw Error(`Unexpected import ${id}`); return mods[id]; }, Error, Promise, Date, Number, JSON, String });
  return exports;
}
const plans = load('domain-connection-plans.ts', {});
let count = 0;
const ok = (expr, label) => { assert.ok(expr, label); count++; };
const eq = (a,b,label) => { assert.equal(a,b,label); count++; };
const host = 'cluster.azurestudios.dev';
const profile = (mode, provider, publicPort = 443) => ({ mode, provider, webPort: 3000, apiPort: 4000, publicPort });
const variants = [
  profile('lan','manual',80), profile('lan','caddy',80), profile('lan','nginx',80),
  profile('private_vpn','tailscale'), profile('private_vpn','wireguard'), profile('private_vpn','custom'),
  profile('reverse_proxy','caddy'), profile('reverse_proxy','nginx'), profile('reverse_proxy','custom'),
  profile('direct_https','manual'), profile('direct_https','caddy'), profile('direct_https','nginx'),
  profile('managed_tunnel','cloudflare'), profile('managed_tunnel','custom'),
];
for (const conf of variants) {
  const plan = plans.buildDomainConnectionPlan(host, conf);
  eq(plan.mode, conf.mode, 'mode roundtrip');
  eq(plan.deploymentState, 'operator_action_required', 'no false provisioning');
  ok(plan.artifacts.some(a=>a.filename==='cluster-network-settings.json'), 'server settings generated');
  ok(plan.artifacts.some(a=>a.filename==='connection-check.ps1'), 'outside client test generated');
  ok(plan.instructions.some(line=>line.includes('Desktop')), 'Desktop client covered');
  ok(plan.origin.web.includes(':3000') && plan.origin.api.includes(':4000'), 'both origins included');
  ok(!plan.artifacts.some(a=>/private key|BEGIN.*PRIVATE/.test(a.contents)), 'no secret output');
}
const caddy = plans.buildDomainConnectionPlan(host, profile('direct_https','caddy')).artifacts.find(a=>a.filename==='Caddyfile').contents;
ok(caddy.includes('reverse_proxy 127.0.0.1:3000') && !caddy.includes('127.0.0.1:4000'), 'Caddy proxies all paths through managed gateway');
const nginx = plans.buildDomainConnectionPlan(host, profile('reverse_proxy','nginx')).artifacts.find(a=>a.filename==='cluster-nginx.conf').contents;
ok(nginx.includes('listen 443 ssl') && nginx.includes('proxy_pass http://127.0.0.1:3000') && !nginx.includes('127.0.0.1:4000'), 'NGINX HTTPS routes through managed gateway');
const cf = plans.buildDomainConnectionPlan(host, profile('managed_tunnel','cloudflare')).artifacts.find(a=>a.filename==='cloudflared-config.yml').contents;
ok(cf.includes('http_status:404') && cf.includes(`hostname: ${host}`) && cf.includes('service: http://127.0.0.1:3000') && !cf.includes('127.0.0.1:4000'), 'Cloudflare routes all paths to managed gateway');
const cfArtifacts = plans.buildDomainConnectionPlan(host, profile('managed_tunnel','cloudflare')).artifacts;
ok(cfArtifacts.some(a=>a.filename==='cloudflared-setup.txt' && a.contents.includes('--config ./cloudflared-config.yml tunnel ingress validate')), 'locally-managed Cloudflare explicit config path');
ok(cfArtifacts.some(a=>a.filename==='cloudflare-dashboard-setup.txt' && a.contents.includes('http://127.0.0.1:3000')), 'Cloudflare dashboard managed origin instructions');
const tsPlan = plans.buildDomainConnectionPlan(host, profile('private_vpn','tailscale'));
ok(tsPlan.artifacts.some(a=>a.filename==='tailscale-serve.txt' && a.contents.includes('tailscale serve --bg 3000')), 'Tailscale targets managed gateway directly');
ok(!tsPlan.artifacts.some(a=>a.filename==='Caddyfile'), 'Tailscale does not require a second routing proxy');
ok(tsPlan.instructions.some(line=>line.includes('actual HTTPS address')), 'Tailscale custom domain warning');
const nativeHttps = plans.buildDomainConnectionPlan(host, profile('direct_https','manual'));
ok(nativeHttps.artifacts.some(a=>a.filename==='native-https-setup.txt' && a.contents.includes('webTlsCertFile')), 'native HTTPS includes certificate settings');
ok(!nativeHttps.artifacts.some(a=>a.filename==='Caddyfile' || a.filename==='cluster-nginx.conf'), 'native HTTPS does not require a proxy');
const lan = plans.buildDomainConnectionPlan(host, profile('lan','caddy',80));
ok(lan.canonicalUrl.startsWith('http://') && !lan.artifacts.find(a=>a.filename==='Caddyfile').contents.includes('https://'), 'LAN mode accurately HTTP');
ok(plans.buildDomainConnectionPlan(host, profile('lan','manual',80)).instructions.some(text=>text.includes('port 80') && text.includes('3000')), 'LAN manual includes real proxy and configured-port instructions');
for (const conf of variants) {
  const plan = plans.buildDomainConnectionPlan(host, conf);
  const text = plan.artifacts.map(a=>a.contents).join('\n');
  ok(!text.includes('reverse_proxy @api') && !text.includes('proxy_pass http://127.0.0.1:4000') && !text.includes('service: http://127.0.0.1:4000'), 'no connection plan forwards to the private Node API');
}
for (const [invalid, why] of [
  [{...profile('managed_tunnel','cloudflare'),publicPort:80}, 'invalid public TLS port'],
  [profile('direct_https','cloudflare'), 'tunnel provider is not a direct HTTPS listener'],
  [profile('lan','cloudflare',80), 'LAN cannot use tunnel provider'],
  [{...profile('reverse_proxy','caddy'),apiPort:3000}, 'origin port collision'],
  [{...profile('lan','manual',80), webPort:0}, 'invalid zero origin'],
]) { assert.throws(()=> plans.validateConnectionConfiguration(invalid), undefined, why); count++; }
for(const bad of ['bad; rm -rf /','evil.com\nHeader: thing','<script>.dev','x..dev']) { assert.throws(()=>plans.buildDomainConnectionPlan(bad,profile('direct_https','caddy'))); count++; }
const ui = fs.readFileSync(new URL('../../packages/renderer/src/features/domains/DomainManagementPanel.tsx', import.meta.url), 'utf8');
ok(ui.includes('Gateway upstream for every external route:') && ui.includes('Never route a proxy or tunnel directly'), 'domain UI forbids public access to Node private port');
// Validate route authorization, concurrency, fail-closed audit and local-probe isolation.
const chain = new Proxy(function() {}, { get(_, prop) { if(prop==='safeParse') return input=>({success:!!input, data:input}); return ()=>chain; }, apply:()=>chain });
const z = new Proxy({}, {get:()=>chain});
const socketProbe = async port => port===3000 ? 'listening' : 'unreachable';
const readiness = load('domain-public-readiness.ts', {'node:https': require('node:https'), 'node:dns/promises': require('node:dns/promises'), 'node:net': require('node:net')});
for (const ip of ['127.0.0.1','169.254.169.254','10.0.0.1','192.168.1.1','172.16.0.1','100.100.100.100','198.51.100.9','203.0.113.1','224.0.0.1']) { eq(readiness.isPublicIpv4(ip),false,'private or reserved IP denied'); }
for (const ip of ['1.1.1.1','8.8.8.8','93.184.215.14']) { eq(readiness.isPublicIpv4(ip),true,'public IP accepted'); }
const unsafeReadiness = await readiness.publicHttpsReadiness(host,{resolveAddresses:async()=>['127.0.0.1','169.254.169.254'],request:()=>{throw Error('No request allowed');}});
eq(unsafeReadiness.dns,'no_public_ipv4','never send private DNS target to HTTPS');
const deployment = load('domain-deployment-readiness.ts', {'node:crypto': require('node:crypto'), 'node:net': require('node:net'), './domain-connection-plans.js': plans});
const routesModule = load('domain-connection-routes.ts', {'node:net': {default:{createConnection(){ throw Error('unexpected socket'); }}}, 'zod':{z}, './domain-connection-plans.js':plans, './domain-public-readiness.js':readiness, './domain-deployment-readiness.js':deployment});
const routes = new Map();
const id = '41aac9b9-9850-4243-a422-d974a31d6d44';
const serverId = '41aac9b9-9850-4243-a422-d974a31d6d44';
const record = {id, domain:'azurestudios.dev', bindingHostname:host, bindingServerInstanceId:serverId, verificationState:'verified', revision:5};
let auditPass = true, allow = true;
const clone=()=>structuredClone(record);
const orm = r => ({studioManagedDomain:{
  async findUnique({where}){return where.id===id ? {...r}:null;},
  async updateMany({where,data}) { if(where.id!==id||where.revision!==r.revision||where.bindingServerInstanceId!==r.bindingServerInstanceId||where.verificationState!==r.verificationState) return {count:0}; Object.assign(r,{...data,revision:r.revision+1});return {count:1};}
}});
const prisma = {...orm(record),async $transaction(fn) { const temp=clone();const result=await fn(orm(temp));Object.assign(record,temp);return result; }};
const auditService = {async recordSecurityInTransaction(){return {ok:auditPass};}};
routesModule.registerDomainConnectionRoutes({app:{get(path,fn){routes.set(`GET ${path}`,fn)},put(path,fn){routes.set(`PUT ${path}`,fn)}},prisma,authorization:{async requireAdmin(){return allow}},getCurrentUser:async()=>({id:'admin-1'}),auditService,readSettings:async()=>({serverInstanceId:serverId}),localProbe:socketProbe,publicProbe:async()=>({dns:'public_ipv4',tls:'trusted',http:'healthy'})});
const request = (method, body) => ({params:{id},method,url:'/api/admin/domains/'+id+'/connection',id:'req1',body});
const reply=()=>({statusCode:200,headers:{},code(n){this.statusCode=n;return this;},header(k,v){this.headers[k]=v;return this;},send(value){this.sent=value;return value;}});
const put=routes.get('PUT /api/admin/domains/:id/connection');
const get=routes.get('GET /api/admin/domains/:id/connection');
const check=routes.get('GET /api/admin/domains/:id/connection/check');
const checkPublic=routes.get('GET /api/admin/domains/:id/connection/check-public');
const bundleRoute=routes.get('GET /api/admin/domains/:id/deployment/bundle');
const readinessRoute=routes.get('GET /api/admin/domains/:id/deployment/readiness');
const setupIntentRoute=routes.get('GET /api/admin/domains/setup-intent');
let response=await put(request('PUT',{expectedRevision:5,...profile('managed_tunnel','cloudflare')}),reply());
ok(response?.ok===true && record.connectionMode==='managed_tunnel','save profile on verified local binding');
eq(record.revision,6,'revision increased');
let denied=reply();await put(request('PUT',{expectedRevision:5,...profile('managed_tunnel','cloudflare')}),denied);eq(denied.sent.code,'STALE_DOMAIN_REVISION','stale rejected');
auditPass=false;denied=reply();await put(request('PUT',{expectedRevision:6,...profile('lan','manual',80)}),denied);eq(denied.sent.code,'CONNECTION_CONFIG_CONFLICT_OR_AUDIT_FAILURE','audit fail closed');eq(record.connectionMode,'managed_tunnel','audit rollback');
auditPass=true;allow=false;denied=reply();await get(request('GET'),denied);ok(!denied.sent,'unauthorized blocked');allow=true;
response=await get(request('GET'),reply());ok(response?.plan?.artifacts?.length>0,'authorized plan can be retrieved');
response=await bundleRoute(request('GET'),reply());
ok(response.bundle?.sha256?.length===64 && response.bundle?.revision===6,'operator bundle pinned to current revision');
eq(response.bundle?.deploymentState,'requires_operator_review','package cannot claim active gateway');
response=await readinessRoute(request('GET'),reply());
eq(response.configured,false,'unconfigured server fails readiness');
const nativeConfig = JSON.parse(nativeHttps.artifacts.find(a=>a.filename==='cluster-network-settings.json').contents);
ok(nativeConfig.webHost.includes('REPLACE_WITH_') && nativeConfig.webTlsCertFile.includes('REPLACE_WITH_'), 'native HTTPS template cannot accidentally be applied without interface and PEM paths');
const nativeReadiness = deployment.domainDeploymentReadiness(host, profile('direct_https','manual'), {
  ...nativeConfig, webHost:'192.168.50.22', webTlsCertFile:'C:/Cluster/tls/cert.pem', webTlsKeyFile:'C:/Cluster/tls/key.pem',
});
ok(nativeReadiness.configured,'native HTTPS configuration is considered complete only with explicit interface and TLS paths');
eq(nativeReadiness.gatewayInstalled,'not_verified','configured native HTTPS does not claim validated certificate or live listener');
eq(response.gatewayInstalled,'not_verified','readiness not gateway existence');
response=await setupIntentRoute(request('GET'),reply());eq(response.verified,false,'OOBE intent never indicates verified DNS');
response=await check(request('GET'),reply());eq(response.local.web,'listening','local web probe');eq(response.local.api,'unreachable','local API probe');eq(response.publicHttps,'not_checked','no fake public HTTPS verification');
response=await checkPublic(request('GET'),reply());eq(response.tls,'trusted','pinned public TLS diagnostic');
record.connectionMode='lan';record.connectionProvider='manual';record.connectionPublicPort=80;
let privateReply=reply();await checkPublic(request('GET'),privateReply);eq(privateReply.sent.code,'PRIVATE_NETWORK_REQUIRES_CLIENT_SIDE_CHECK','private network never probed externally');
record.bindingServerInstanceId='other-server';denied=reply();await check(request('GET'),denied);eq(denied.sent.code,'LOCAL_SERVER_BINDING_REQUIRED','cannot inspect another instance');
denied=reply();await bundleRoute(request('GET'),denied);eq(denied.sent.code,'LOCAL_SERVER_BINDING_REQUIRED','bundle refused for remote instance');
allow=false;denied=reply();await readinessRoute(request('GET'),denied);ok(!denied.sent,'unauthorized cannot inspect readiness');
console.log(JSON.stringify({passed:count, connectionModes:5, testedProfiles:variants.length, routeTests:'passed'}));
