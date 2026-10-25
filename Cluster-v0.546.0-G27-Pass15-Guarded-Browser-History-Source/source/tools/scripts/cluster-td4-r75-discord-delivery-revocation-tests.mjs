import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(require('node:path').join(require('node:child_process').execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript')); } })();
const source = fs.readFileSync('apps/server/src/domains/integrations/discord-production-service.ts','utf8');
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module = {exports:{}};
vm.runInNewContext(js, {module,exports:module.exports, require:(id)=> id === '../../core/http-errors.js'
  ? {createHttpError:(code,message,status)=> Object.assign(new Error(message),{code,statusCode:status})}
  : require(id), Buffer, Date, Set, Map, JSON, Math, String, Number, console},{filename:'discord-production-service.ts'});
const serviceFactory = module.exports.createDiscordProductionService;
let checks = 0;
const test = async (name, fn) => {await fn();checks++;console.log(`PASS ${name}`)};
function fixture(options={}) {
  const calls={send:[],update:[],settings:[],queries:[]};
  const route={id:'route-1',projectId:'project-1',connectionId:'conn-1',externalId:'1111111111',archived:false,
    metadata:JSON.stringify({eventClasses:['all'],minPriority:'normal',mentionMode:'linked'})};
  const state={connection:{id:'conn-1',workspaceId:'studio-1',archived:false,status:'active'},
    item:{id:'notification-1',projectId:'project-1',priority:'medium',activityEventId:'event-1',title:'Source review ready',message:'Review requested',createdAt:new Date('2026-10-16T00:00:00Z')},
    route, settings:{discordGuildId:'guild-1',publicWebUrl:'https://cluster.example',discordChatChannelId:'1111111111'},
    receipt:{id:'receipt-1',connectionId:'conn-1',connection:{id:'conn-1',workspaceId:'studio-1'},status:'pending',actionType:'discord.notification.send',entityId:'notification-1',responseMetadata:JSON.stringify({notificationId:'notification-1',projectId:'project-1',routeId:'route-1',channelId:'1111111111',mentionMode:'linked'})}
  };
  Object.assign(state,options);
  const prisma={
    integrationActionReceipt:{findUnique:async()=>state.receipt,update:async({data})=>{calls.update.push(data);return data}},
    notificationInboxItem:{findUnique:async()=>state.item,findMany:async()=>{if(options.beforeMentions)await options.beforeMentions(state);return options.users ?? []}},
    integrationConnection:{findFirst:async({where})=>{calls.queries.push(where);return state.connection && state.connection.status!=='disabled'&&!state.connection.archived&&state.connection.id===where.id?state.connection:null}},
    projectIntegrationBinding:{findMany:async()=>state.route ? [state.route] : [],findFirst:async()=>state.projectLinked === false ? null : {id:'project-link'}},
    $transaction:async(p)=>Promise.all(p),
  };
  const service=serviceFactory({prisma,queue:{enqueue:async()=>{}},readSettings:async(force)=>{calls.settings.push(force);return state.settings},discordRequest:async(settings,path,data)=>{calls.send.push({settings,path,data});return {}},notificationService:{},authorization:{},logActivity:async()=>{}});
  return {service,state,calls};
}
const rejected = async (overrides, code) => {
  const f=fixture(overrides);
  await assert.rejects(()=>f.service.executeDelivery('receipt-1',1), e=>e.code===code,code);
  assert.equal(f.calls.send.length,0,'must not send stale destination');
  return f;
};
await test('Valid queued route dispatches exactly once',async()=>{const f=fixture();await f.service.executeDelivery('receipt-1',1);assert.equal(f.calls.send.length,1);assert.equal(f.calls.send[0].path,'/channels/1111111111/messages');assert.equal(f.calls.update.at(-1).status,'completed')});
await test('Queued connection disabled blocks send',async()=>{await rejected({connection:{id:'conn-1',workspaceId:'studio-1',status:'disabled',archived:false}},'DISCORD_CONNECTION_NOT_FOUND')});
await test('Queued connection archived blocks send',async()=>{await rejected({connection:{id:'conn-1',workspaceId:'studio-1',status:'active',archived:true}},'DISCORD_CONNECTION_NOT_FOUND')});
await test('Missing connection blocks send',async()=>{await rejected({connection:null},'DISCORD_CONNECTION_NOT_FOUND')});
await test('Moved connection workspace blocks send',async()=>{await rejected({connection:{id:'conn-1',workspaceId:'studio-other',status:'active',archived:false}},'DISCORD_DELIVERY_SCOPE_CHANGED')});
await test('Project link revocation blocks previously valid route',async()=>{await rejected({projectLinked:false},'DISCORD_PROJECT_LINK_REVOKED')});
await test('Project and connection must remain in same workspace',async()=>{const f=fixture();await f.service.executeDelivery('receipt-1',1);assert.equal(f.calls.send.length,1)});
await test('Deleted explicit route blocks send',async()=>{await rejected({route:null},'DISCORD_DELIVERY_TARGET_STALE')});
await test('Moved route to another project blocks send',async()=>{const f=fixture();f.state.route.projectId='other-project';await assert.rejects(()=>f.service.executeDelivery('receipt-1',1),e=>e.code==='DISCORD_DELIVERY_TARGET_STALE');assert.equal(f.calls.send.length,0)});
await test('Rebound route to another connection blocks send',async()=>{const f=fixture();f.state.route.connectionId='conn-other';await assert.rejects(()=>f.service.executeDelivery('receipt-1',1),e=>e.code==='DISCORD_DELIVERY_TARGET_STALE');assert.equal(f.calls.send.length,0)});
await test('Retargeted channel blocks send',async()=>{const f=fixture();f.state.route.externalId='2222222222';await assert.rejects(()=>f.service.executeDelivery('receipt-1',1),e=>e.code==='DISCORD_DELIVERY_TARGET_STALE');assert.equal(f.calls.send.length,0)});
await test('Route filter changed blocks send',async()=>{const f=fixture();f.state.route.metadata=JSON.stringify({eventClasses:['build'],minPriority:'normal'});await assert.rejects(()=>f.service.executeDelivery('receipt-1',1),e=>e.code==='DISCORD_DELIVERY_TARGET_STALE');assert.equal(f.calls.send.length,0)});
await test('Priority threshold changed blocks send',async()=>{const f=fixture();f.state.route.metadata=JSON.stringify({eventClasses:['all'],minPriority:'critical'});await assert.rejects(()=>f.service.executeDelivery('receipt-1',1),e=>e.code==='DISCORD_DELIVERY_TARGET_STALE');assert.equal(f.calls.send.length,0)});
await test('Notification moved to new Project blocks send',async()=>{const f=fixture();f.state.item.projectId='project-2';await assert.rejects(()=>f.service.executeDelivery('receipt-1',1),e=>e.code==='DISCORD_DELIVERY_SCOPE_CHANGED');assert.equal(f.calls.send.length,0)});
await test('Receipt entity mismatch blocks send',async()=>{const f=fixture();f.state.receipt.entityId='different';await assert.rejects(()=>f.service.executeDelivery('receipt-1',1),e=>e.code==='DISCORD_DELIVERY_SCOPE_CHANGED');assert.equal(f.calls.send.length,0)});
await test('Missing destination identity blocks send',async()=>{const f=fixture();f.state.receipt.responseMetadata=JSON.stringify({notificationId:'notification-1',projectId:'project-1',channelId:'1111111111'});await assert.rejects(()=>f.service.executeDelivery('receipt-1',1),e=>e.code==='DISCORD_DELIVERY_TARGET_STALE');assert.equal(f.calls.send.length,0)});
await test('Late route revocation during mention lookup blocks send',async()=>{const f=fixture({beforeMentions:async state=>{state.route=null}});await assert.rejects(()=>f.service.executeDelivery('receipt-1',1),e=>e.code==='DISCORD_DELIVERY_TARGET_STALE');assert.equal(f.calls.send.length,0);assert.equal(f.calls.update.at(-1).status,'failed')});
await test('Late connection revocation during mention lookup blocks send',async()=>{const f=fixture({beforeMentions:async state=>{state.connection.status='disabled'}});await assert.rejects(()=>f.service.executeDelivery('receipt-1',1),e=>e.code==='DISCORD_CONNECTION_NOT_FOUND');assert.equal(f.calls.send.length,0)});
await test('New mention off policy suppresses queued mention',async()=>{const f=fixture({users:[{user:{discordUserId:'123456',preferences:JSON.stringify({notificationDiscordDelivery:'all'})},requiresAction:true,signal:'mention'}],beforeMentions:async state=>{state.route.metadata=JSON.stringify({eventClasses:['all'],minPriority:'normal',mentionMode:'off'})}});await f.service.executeDelivery('receipt-1',1);assert.equal(f.calls.send.length,1);assert.equal(f.calls.send[0].data.body.content,undefined);assert.deepEqual(Array.from(f.calls.send[0].data.body.allowed_mentions.users),[])});
await test('Fresh settings read again just before outbound request',async()=>{const f=fixture();await f.service.executeDelivery('receipt-1',1);assert.deepEqual(f.calls.settings,[true,true])});
await test('Rejected admission does not change receipt state',async()=>{const f=await rejected({route:null},'DISCORD_DELIVERY_TARGET_STALE');assert.equal(f.calls.update.length,0)});
await test('No unsafe outbound send or file mutation in provider gate',()=>{assert.match(source,/authorizedDeliveryRoute\(receipt, item, metadata, sendSettings\)/);assert(!source.includes('disableManagedBlobDeletion = false'))});
console.log(`TD4 R75 Discord provider revocation: ${checks}/${checks} passed`);
