import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js')); } })();
const load = (file, dependencies = {}) => {
  const source = fs.readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 } });
  const mod = { exports:{} };
  vm.runInNewContext(compiled.outputText, { module:mod,exports:mod.exports,require:(id)=>{
    if (id in dependencies) return dependencies[id];
    throw Error(`Unmocked dependency ${id}`);
  }, Buffer, Date, Set, Object, String, Error });
  return mod.exports;
};
const policy = load('apps/server/src/core/context-pack-policy.ts');
const verification = load('apps/server/src/core/security-verification.ts');
const session = load('apps/server/src/core/session-security.ts', {'./security-verification.js':verification});
const routeSource=fs.readFileSync('apps/server/src/app/server-routes-context-packs.ts','utf8');
const requestDomain=fs.readFileSync('apps/server/src/app/server-services-request-domain.ts','utf8');
let total=0,passed=0;
async function check(name,fn){total++;try{await fn();passed++;console.log(`PASS ${name}`)}catch(e){console.error(`FAIL ${name}: ${e.stack}`);process.exitCode=1}}
const fixture={schemaVersion:1,kind:'cluster.context-pack',settings:{discordBotToken:'SECRET_TOKEN',discordWebhookUrl:'SECRET_WEBHOOK',discordGuildId:'safe',fontFamily:'Comfortaa',unexpected:'INJECTED'}};
await check('safe export removes every secret and unrecognized field',()=>{
 const result=policy.projectContextPackPayload(fixture);
 assert.equal(result.settings.discordBotToken,undefined);
 assert.equal(result.settings.discordWebhookUrl,undefined);
 assert.equal(result.settings.discordGuildId,'safe');
 assert.equal(result.settings.fontFamily,'Comfortaa');
 assert.equal(result.settings.unexpected,undefined);
 assert.equal(result.includesSecrets,false);
 assert.equal(result.secretsRedacted,true);
});
await check('privileged projection reveals only allowlisted secret fields',()=>{
 const result=policy.projectContextPackPayload(fixture,true);
 assert.equal(result.settings.discordBotToken,'SECRET_TOKEN');
 assert.equal(result.settings.discordWebhookUrl,'SECRET_WEBHOOK');
 assert.equal(result.settings.unexpected,undefined);
 assert.equal(result.includesSecrets,true);
});
await check('import rejects unknown keys instead of preserving opaque payload',()=>{
 assert.throws(()=>policy.validateContextPackImport(fixture),/Unknown Context Pack setting/);
 const polluted=JSON.parse('{"settings":{"__proto__":{"admin":true}}}');
 assert.throws(()=>policy.validateContextPackImport(polluted),/Unknown Context Pack setting/);
});
await check('import rejects oversized and non-string values',()=>{
 assert.throws(()=>policy.validateContextPackImport({settings:{fontFamily:'x'.repeat(8193)}}),/Invalid Context Pack setting/);
 assert.throws(()=>policy.validateContextPackImport({settings:{discordGuildId:{value:'xyz'}}}),/Invalid Context Pack setting/);
 assert.throws(()=>policy.validateContextPackImport({settings:{tagPresetCsv:'z'.repeat(8000)},padding:'z'.repeat(131072)}),/size limit/);
});
await check('valid imported settings preserve only permitted values',()=>{
 const parsed=policy.validateContextPackImport({kind:'cluster.context-pack',schemaVersion:1,settings:{fontFamily:'Comfortaa',discordGuildId:'1234',discordBotToken:'TOKEN'}});
 assert.equal(parsed.settings.fontFamily,'Comfortaa');
 assert.equal(parsed.settings.discordBotToken,'TOKEN');
 assert.equal(parsed.includesSecrets,true);
 assert.equal(Object.keys(parsed.settings).length,3);
});
await check('secret export purpose requires strong, single-use step-up',()=>{
 const p=verification.securityVerificationPolicy('context_secret_export');
 assert.equal(p.minimumStrength,'phishing_resistant');
 assert.equal(p.singleUse,true);
 assert.equal(p.freshLoginSatisfies,false);
 assert.equal(p.reasonMode,'required');
 assert.equal(verification.highRiskSecurityVerificationPurpose('context_secret_export'),true);
});
await check('only protected endpoints receive secret-export purpose',()=>{
 for(const pathname of ['/api/context-packs/123/secret-export','/api/context-packs/from-settings-with-secrets','/api/context-packs/123/apply']) assert.equal(session.reauthPurposeForRequest(pathname,'POST',true),'context_secret_export');
 assert.equal(session.reauthPurposeForRequest('/api/context-packs/123/export','GET',true),'context_export');
 assert.equal(session.reauthPurposeForRequest('/api/context-packs/123/secret-export','POST',false),null);
 assert.equal(session.reauthPurposeForRequest('/api/context-packs','GET',true),null);
});
const chain=()=>({min(){return this},max(){return this},optional(){return this},nullable(){return this}});
const z={string:chain,boolean:chain,unknown:chain,object:()=>({parse:(value)=>value})};
const preconditions={expectedServerConfigFields:()=>({})};
const routes=(deps)=>{
 const app={},handlers=new Map();
 for(const verb of ['get','post','delete'])app[verb]=(url,fn)=>handlers.set(`${verb.toUpperCase()} ${url}`,fn);
 load('apps/server/src/app/server-routes-context-packs.ts',{'zod':{z},'../core/server-config-preconditions.js':preconditions,'../core/setting-crypto.js':{encryptContextPackStorageValue:x=>x},'../core/context-pack-policy.js':policy}).registerContextPackRoutes({app,...deps});
 return handlers;
};
function createReply(){let status=200,body=null;const headers={};const res={header:(k,v)=>{headers[k]=v;return res},code:(n)=>{status=n;return res},send:(x)=>{body=x;return x},get status(){return status},get body(){return body},get headers(){return headers}};return res;}
await check('ordinary export never opts in to revealing secrets',async()=>{
 const calls=[];const handlers=routes({authorization:{requireAdmin:async()=>({id:'owner'})},prisma:{contextPack:{findUniqueOrThrow:async()=>({id:'1',payload:'{}'})}},serializeContextPack:(...args)=>{calls.push(args);return {ok:true}},});
 const r=createReply();await handlers.get('GET /api/context-packs/:packId/export')({params:{packId:'1'}},r);
 assert.equal(calls.length,1);assert.equal(calls[0][1],true);assert.notEqual(calls[0][2],true);assert.equal(r.headers['Cache-Control'],'no-store');
});
await check('protected secret export requires reason and logs no credential',async()=>{
 let hits=0,events=[],calls=[];const handlers=routes({authorization:{requireAdmin:async()=>({id:'owner'})},getCurrentUser:async()=>({id:'owner'}),prisma:{contextPack:{findUniqueOrThrow:async()=>{hits++;return {id:'1',name:'Settings',payload:'{}'}}}},logActivity:async(x)=>events.push(x),serializeContextPack:(...args)=>{calls.push(args);return {ok:true}}});
 const invalid=createReply(); await handlers.get('POST /api/context-packs/:packId/secret-export')({params:{packId:'1'},body:{reason:'short'}},invalid);
 assert.equal(invalid.status,400);assert.equal(hits,0);
 const valid=createReply(); await handlers.get('POST /api/context-packs/:packId/secret-export')({params:{packId:'1'},body:{reason:'Approved offsite backup'}},valid);
 assert.equal(hits,1);assert.equal(calls[0][2],true);assert.equal(valid.headers['Cache-Control'],'no-store');
 assert.equal(events[0].metadata.sensitiveExport,true);assert.equal(JSON.stringify(events).includes('SECRET_TOKEN'),false);
});
await check('ordinary pack creation refuses includeSecrets before reading settings',async()=>{
 let reads=0;const handlers=routes({authorization:{requireAdmin:async()=>({id:'owner'})},getCurrentUser:async()=>({id:'owner'}),readSettings:async()=>{reads++;return {}},buildContextPackPayload:()=>({})});
 const r=createReply();await handlers.get('POST /api/context-packs/from-settings')({body:{name:'Settings',includeSecrets:true}},r);
 assert.equal(r.status,400);assert.equal(reads,0);
});
await check('protected pack creation requires reason before reading settings',async()=>{
 let reads=0;const handlers=routes({authorization:{requireAdmin:async()=>({id:'owner'})},getCurrentUser:async()=>({id:'owner'}),readSettings:async()=>{reads++;return {}},buildContextPackPayload:()=>({})});
 const r=createReply();await handlers.get('POST /api/context-packs/from-settings-with-secrets')({body:{name:'Settings'}},r);
 assert.equal(r.status,400);assert.equal(reads,0);
});
await check('server serializer uses central projection even for creation/import replies',()=>{
 assert.match(requestDomain,/payload: projectContextPackPayload\(payload, revealSecrets\)/);
 assert.match(requestDomain,/function serializeContextPack\(pack: any, includePayload = false, revealSecrets = false\)/);
 assert.match(routeSource,/serializeContextPack\(pack, true, true\)/);
});
await check('reauth UI carries required reason into passkey verification',()=>{
 const ui=fs.readFileSync('packages/renderer/src/components/ReauthenticationHost.tsx','utf8');
 const transport=fs.readFileSync('packages/renderer/src/core/api/transport.ts','utf8');
 assert.match(transport,/reauthenticationReasonMode/);
 assert.match(ui,/request\.reasonMode === "required"/);
 assert.match(ui,/body: JSON\.stringify\(\{ purpose: request\.purpose, reason: reason\.trim\(\) \|\| undefined \}\)/);
 assert.match(ui,/request\.passkeyRequired && \(mode !== "passkey"/);
});
console.log(`${passed}/${total} Context Pack sensitive boundary checks passed`);if(passed!==total)process.exitCode=1;
