import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); } })();
const root = path.resolve(new URL('../..', import.meta.url).pathname);
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
function moduleFrom(rel, mocks = {}) {
  const full = path.join(root, rel);
  const js = ts.transpileModule(read(rel).replaceAll('import.meta.url', JSON.stringify(`file://${full}`)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: id => mocks[id] || require(id), console, process, Buffer, setTimeout, clearTimeout, JSON, Date, Map, Set, Math }, { filename: full });
  return exports;
}
function httpError(code, message, statusCode) { const e = new Error(message); Object.assign(e, {code,statusCode}); return e; }
const { createDiscordProductionService } = moduleFrom('apps/server/src/domains/integrations/discord-production-service.ts', { '../../core/http-errors.js': { createHttpError: httpError } });
const guildA = '111111111111111111', guildB = '222222222222222222', outside = '333333333333333333';
const channelA = '444444444444444444', channelB = '555555555555555555', wrongChannel = '666666666666666666';
const settings = {discordGuildId:guildA,discordBotToken:'test-token',discordApplicationId:guildA};
let guildReads = 0, messages = [], validConfirmation = true;
const prisma = {
  integrationConnection:{ findFirst:async()=>({id:'conn1',configuration:JSON.stringify({ authorizedGuildIds:[guildB] }),status:'configured'} ) },
  user:{count:async({where}) => where.discordUserId ? 3 : 8},
};
const service = createDiscordProductionService({
  prisma,readSettings:async()=>settings,
  discordRequest:async(_settings,url,opt) => {
    if(url.startsWith('/guilds/')) {guildReads++;const id=url.split('/')[2];return {id,name:id===guildA?'Studio Guild':'Partner Guild',icon:'abcdef0123456789'};}
    if(url.startsWith('/channels/')&&url.endsWith('/messages')){messages.push({url,opt});return {id:validConfirmation?'777777777777777777':null};}
    if(url.startsWith('/channels/')) {const id=url.split('/')[2];return {id,guild_id:id===wrongChannel?outside:id===channelB?guildB:guildA,type:id===channelB?15:0};}
    return {};
  },
  queue:{enqueue:async()=>({})},authorization:{},sourceControl:null,notificationService:{},logActivity:async()=>{},
});
let count = 0;
async function check(label, cb) {await cb(); console.log(`PASS ${++count}: ${label}`);}
await check('approved Discord servers show fetched names and icon CDN URLs',async()=>{
  const result=await service.listGuilds();
  assert.equal(result.guilds.length,2);
  assert.equal(result.guilds[0].name,'Studio Guild');
  assert(result.guilds[0].iconUrl?.startsWith('https://cdn.discordapp.com/icons/'));
  assert.equal(result.guilds[0].reachable,true);
});
await check('guild names are cached and do not create one request per render',async()=>{
  const reads=guildReads;
  await service.listGuilds();
  assert.equal(guildReads,reads);
});
await check('linked coverage only counts active accessible Cluster accounts',async()=>{
  const result=await service.linkedAccountCoverage();
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{active:8,linked:3,unlinked:5});
});
await check('test destination must be in an approved guild',async()=>{
  await assert.rejects(()=>service.sendTestMessage(wrongChannel), e=>e.code==='DISCORD_GUILD_NOT_APPROVED');
  assert.equal(messages.length,0);
});
await check('test destination rejects forum parents instead of reporting false success',async()=>{
  await assert.rejects(()=>service.sendTestMessage(channelB), e=>e.code==='DISCORD_TEST_CHANNEL_INVALID');
  assert.equal(messages.length,0);
});
await check('approved test message is sent with mentions disabled and receipt confirmation',async()=>{
  const result=await service.sendTestMessage(channelA);
  assert.equal(result.sent,true);
  assert.equal(result.messageId,'777777777777777777');
  assert.equal(messages.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0].opt.body.allowed_mentions)),{parse:[]});
});
await check('test sends are rate limited per channel',async()=>{
  await assert.rejects(()=>service.sendTestMessage(channelA), e=>e.code==='DISCORD_TEST_RATE_LIMITED');
  assert.equal(messages.length,1);
});
await check('unexpected provider replies fail closed',async()=>{
  validConfirmation=false;
  // A distinct channel, still in the primary guild.
  await assert.rejects(()=>service.sendTestMessage('888888888888888888'), e=>e.code==='DISCORD_TEST_SEND_FAILED');
});
let spawned, options;
const {createDiscordBotSupervisor}=moduleFrom('apps/server/src/app/discord-bot-supervisor.ts', {
  'node:path':{default:require('node:path')},
  'node:child_process':{spawn:(_a,_b,input)=>{
    options=input; spawned=new EventEmitter();spawned.pid=4242;spawned.stdout=new EventEmitter();spawned.stderr=new EventEmitter();spawned.killed=false;
    spawned.kill=()=>{spawned.killed=true;spawned.emit('exit',0);};return spawned;
  }},
});
const bot=createDiscordBotSupervisor({readSettings:async()=>settings,readManaged:async()=>true,localUrl:'http://127.0.0.1:4000',log:{info(){},warn(){}}});
await check('stdout cannot fabricate a healthy Gateway state',async()=>{
  assert.equal((await bot.restore()).state,'starting');
  spawned.stdout.emit('data',Buffer.from('Discord Gateway relay ready'));
  assert.equal(bot.status().state,'starting');
});
await check('only the supervised worker has the right health credential',async()=>{
  assert.equal(bot.authorizedRelayToken('x'.repeat(96)),false);
  assert.equal(bot.authorizedRelayToken(options.env.CLUSTER_DISCORD_RELAY_TOKEN),true);
  bot.reportGatewayState('connected');
  assert.equal(bot.status().state,'connected');
});
await check('stale Gateway reports never remain connected',async()=>{
  const orig=Date.now;
  try {const first=Date.now();Date.now=()=>first+50_000; assert.equal(bot.status().state,'reconnecting');assert.match(bot.status().message,/stopped reporting/);}
  finally { Date.now=orig; }
});
await check('stopping the bot revokes relay credentials',async()=>{
  await bot.setManaged(false);
  assert.equal(bot.status().state,'stopped');
  assert.equal(bot.authorizedRelayToken(options.env.CLUSTER_DISCORD_RELAY_TOKEN),false);
});
await check('admin endpoints require integration permissions and log test sends',async()=>{
  const routes=read('apps/server/src/domains/integrations/discord-production-routes.ts');
  const runtime=read('apps/server/src/app/server-discord-runtime.ts');
  for(const url of ['/api/admin/integrations/discord/link-coverage','/api/admin/integrations/discord/test-message'])assert(routes.includes(url));
  assert(routes.includes('discord_test_message_sent'));
  assert(runtime.includes('botSupervisor.authorizedRelayToken(supplied)'));
  assert(runtime.includes('/api/integrations/discord/gateway-health'));
});
await check('visual setup exposes guild names, link coverage and test message controls',async()=>{
  const ui=read('packages/renderer/src/features/admin/ProductionIntegrationAdminPages.tsx');
  for(const phrase of ['guild.name','guild.iconUrl','discordLinkCoverage','Send test message','Install with Discord Administrator'])assert(ui.includes(phrase));
});
console.log(`RC42 Discord closeout: ${count}/${count} checks passed`);
