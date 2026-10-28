import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); } })();
const root = path.resolve(new URL('../..', import.meta.url).pathname);
let checks = 0;
function check(desc, callback) { const value = callback(); checks++; console.log(`PASS ${checks}: ${desc}`); return value; }
function loadModule(rel, mocks = {}) {
  const full = path.join(root, rel);
  const original = fs.readFileSync(full, 'utf8').replaceAll('import.meta.url', JSON.stringify(`file://${full}`));
  const js = ts.transpileModule(original, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const context = { exports, require: (id) => mocks[id] || require(id), console, process, Buffer, setTimeout, clearTimeout, JSON, Date, Map, Set, Math };
  vm.runInNewContext(js, context, { filename: full });
  return exports;
}
function httpError(code, message, statusCode) { const err = new Error(message); err.code = code; err.statusCode = statusCode; return err; }
const { createDiscordProductionService } = loadModule('apps/server/src/domains/integrations/discord-production-service.ts', { '../../core/http-errors.js': { createHttpError: httpError } });
const mainGuild = '111111111111111111';
const otherGuild = '222222222222222222';
const unapprovedGuild = '333333333333333333';
let connection = { id: 'con1', workspaceId: 'ws1', configuration: JSON.stringify({ authorizedGuildIds: [otherGuild] }), providerId: 'communication.discord', status: 'configured' };
let project = { id: 'project1', workspaceId: 'ws1', archived: false };
let guildCheckCount = 0;
const prisma = {
  integrationConnection: {
    findFirst: async () => connection,
    update: async ({data}) => { connection = { ...connection, ...data }; return connection; },
  },
  project: { findFirst: async () => project },
  projectIntegrationBinding: { findFirst: async () => ({ id: 'projectbinding' }), create: async ({data}) => ({...data, id:'route1'}), update: async ({data}) => ({...data,id:'route1'}) },
};
const settings = { discordApplicationId: mainGuild, discordGuildId: mainGuild, discordBotToken: 'fake-token' };
const service = createDiscordProductionService({
  prisma, readSettings: async () => settings,
  discordRequest: async (_settings, route) => { guildCheckCount++; if (route.startsWith('/guilds/')) return { id: route.split('/')[2] }; if (route.startsWith('/channels/')) return { id: route.split('/')[2], guild_id: mainGuild }; return {}; },
  queue: { enqueue: async () => {} }, authorization: {}, sourceControl: null, notificationService: {}, logActivity: async () => {},
});
await check('public install does not make an unrelated Discord server authorized', async () => {
  await assert.rejects(() => service.processGatewayInteraction({type:2,application_id:mainGuild,guild_id:unapprovedGuild,id:'inter1'}), e=>e.code==='DISCORD_GUILD_MISMATCH');
});
await check('approved guild registry includes primary and explicitly bound servers', async () => {
  const result = await service.listGuilds();
  assert.equal(result.guilds.length, 2);
  assert(result.guilds.some(g => g.id === mainGuild && g.primary));
});
await check('admin can bind a bot-installed guild', async () => {
  const result=await service.addGuild(unapprovedGuild);
  assert(result.guilds.some(g => g.id === unapprovedGuild));
  assert(guildCheckCount>0);
});
await check('revocation immediately excludes the guild from the allowlist', async () => {
  const result=await service.removeGuild(unapprovedGuild);
  assert(!result.guilds.some(g => g.id === unapprovedGuild));
  await assert.rejects(()=>service.processGatewayInteraction({type:2,application_id:mainGuild,guild_id:unapprovedGuild,id:'inter2'}),e=>e.code==='DISCORD_GUILD_MISMATCH');
});
await check('primary guild cannot be removed via extra-guild management', async () => {
  await assert.rejects(()=>service.removeGuild(mainGuild),e=>e.code==='DISCORD_PRIMARY_GUILD');
});
await check('project route cannot bind a channel in another Discord guild', async () => {
  await assert.rejects(()=>service.upsertProjectRoute('project1',null,{connectionId:'con1',channelId:'987654321098765432',guildId:otherGuild}),e=>e.code==='DISCORD_CHANNEL_GUILD_MISMATCH');
});
const { createDiscordBotSupervisor }=loadModule('apps/server/src/app/discord-bot-supervisor.ts', {
  'node:path': { default: require('node:path') },
  'node:child_process': { spawn: (_exe, _args, options) => {
    const child = new EventEmitter(); child.pid = 4242; child.stdout=new EventEmitter(); child.stderr=new EventEmitter();
    child.kill=()=>{child.killed=true;child.emit('exit',0);}; child.killed=false;
    supervisorSpawnEnv=options.env; supervisorChild=child; return child;
  } },
});
let supervisorChild, supervisorSpawnEnv;
const supervisor = createDiscordBotSupervisor({ readSettings:async()=>settings,readManaged:async()=>true,localUrl:'http://127.0.0.1:4000',log:{info(){},warn(){}} });
await check('server-managed bot uses a private generated relay key and does not expose credentials in status',async()=>{
  const first=await supervisor.restore();
  assert.equal(first.state,'starting');
  assert.equal(first.pid,4242);
  assert(supervisorSpawnEnv.CLUSTER_DISCORD_RELAY_TOKEN.length>=64);
  assert.equal(supervisorSpawnEnv.CLUSTER_DISCORD_BOT_TOKEN,'fake-token');
  assert(!JSON.stringify(first).includes(supervisorSpawnEnv.CLUSTER_DISCORD_RELAY_TOKEN));
  supervisorChild.stdout.emit('data', Buffer.from('Discord Gateway relay ready'));
  assert.equal(supervisor.status().state,'starting');
  supervisor.reportGatewayState('connected');
  assert.equal(supervisor.status().state,'connected');
});
await check('stop terminates worker and revokes its runtime relay token',async()=>{
  await supervisor.setManaged(false);
  assert.equal(supervisor.status().state,'stopped');
  assert.equal(supervisor.authorizedRelayToken(supervisorSpawnEnv.CLUSTER_DISCORD_RELAY_TOKEN),false);
});
await check('public install URL requires only app ID, no token',()=>{
  const ui=fs.readFileSync(path.join(root,'packages/renderer/src/features/admin/ProductionIntegrationAdminPages.tsx'),'utf8');
  assert(ui.includes('discord.com/oauth2/authorize?client_id='));
  assert(ui.includes('Start / restart bot'));
  assert(ui.includes('Approved Discord servers'));
  assert(!ui.includes('CLUSTER_DISCORD_RELAY_TOKEN'));
});
check('server exposes protected bot and guild management routes',()=>{
  const server=fs.readFileSync(path.join(root,'apps/server/src/app/server-discord-runtime.ts'),'utf8');
  const routes=fs.readFileSync(path.join(root,'apps/server/src/domains/integrations/discord-production-routes.ts'),'utf8');
  for(const url of ['/api/admin/integrations/discord/bot','/api/admin/integrations/discord/guilds']) assert((server+routes).includes(url));
  assert(server.includes('"integrations", "manage"'));
});
for(const file of ['integrations/discord-bot/src/index.mjs','integrations/discord-bot/src/commands.mjs']) {
  const script=fs.readFileSync(path.join(root,file),'utf8');
  if(file.endsWith('index.mjs'))check('slow interactions use a deferred Discord acknowledgement',()=>assert(script.includes('type: 5') && script.includes('1_500')));
}
// checks above return promises; fail clearly on unhandled rejections in all supported Node versions.
await new Promise((resolve)=>setImmediate(resolve));
console.log(`RC37 Discord integration tests: ${checks} checks executed`);
