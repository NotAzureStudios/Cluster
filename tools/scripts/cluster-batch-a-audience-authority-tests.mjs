#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const code = ts.transpileModule(readFileSync('apps/server/src/domains/access/studio-audience.ts','utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const module = {exports:{}};
vm.runInNewContext(code,{module,exports:module.exports,require:(name)=> name==='@cluster/shared'?{studioAudienceSchema:{parse:value=>value}}:require(name),Set,Map,Date,String,Promise}, {filename:'studio-audience.ts'});
const {studioAudienceMatchesUser, studioAudienceMatchesContext, resolveStudioAudienceUserIds, loadStudioAudienceUserContext, parseStudioAudience} = module.exports;
let count=0;
async function test(label,fn){await fn();count++;console.log('PASS '+label);}
const users={id:'member'};
const audience={mode:'exclude',targets:[{kind:'team',id:'confidential-team'}]};
const db={
 employment:{findUnique:async()=>({active:true,departmentId:'studio',jobRoleId:'editor'})},
 studioTeamMember:{findMany:async()=>[{teamId:'confidential-team'}]},
 projectMembership:{findMany:async()=>[]},
};
await test('exclusion audience denies user on matching team',async()=>{
 assert.equal(await studioAudienceMatchesUser(db,audience,users),false);
});
await test('nonexcluded eligible user passes complete identity projection',async()=>{
 const separate={...db,studioTeamMember:{findMany:async()=>[]}};
 assert.equal(await studioAudienceMatchesUser(separate,audience,users),true);
});
for(const name of ['employment','studioTeamMember','projectMembership']) {
 await test('failed '+name+' authority read never becomes an allow',async()=>{
  const failed={...db,[name]:Object.fromEntries(Object.keys(db[name]).map(k=>[k,async()=>{throw Error('db unavailable')}]))};
  await assert.rejects(studioAudienceMatchesUser(failed,audience,users),/db unavailable/);
 });
}
await test('direct context match still excludes normalized team membership',async()=>{
 const matches=studioAudienceMatchesContext(audience,'member',{departmentId:'studio',jobRoleId:'editor',teamIds:new Set(['confidential-team']),projectIds:new Set()});
 assert.equal(matches,false);
});
await test('malformed stored audience cannot silently default to Studio-wide', async()=>{
 assert.throws(()=>parseStudioAudience('{"mode":'), { name: 'SyntaxError' });
 assert.throws(()=>studioAudienceMatchesContext('{invalid', 'member', {teamIds:new Set(),projectIds:new Set()}), { name: 'SyntaxError' });
 const decoded=parseStudioAudience(null);
 assert.equal(decoded.mode,'all');
});
await test('bulk audience targeting defaults to strict authority for exclusion policies', async()=>{
 const bdb={user:{findMany:async()=>[{id:'member'}]},employment:{findMany:async()=>[]},
  studioTeamMember:{findMany:async()=>{throw Error('team authority unavailable')}},
  projectMembership:{findMany:async()=>[]}};
 await assert.rejects(resolveStudioAudienceUserIds(bdb,audience), /team authority unavailable/);
});
await test('bulk audience targeting defaults to strict authority for inclusion policies', async()=>{
 const include={mode:'include',targets:[{kind:'team',id:'confidential-team'}]};
 const bdb={user:{findMany:async()=>[{id:'member'}]},employment:{findMany:async()=>[]},
  studioTeamMember:{findMany:async()=>{throw Error('team authority unavailable')}},projectMembership:{findMany:async()=>[]}};
 await assert.rejects(resolveStudioAudienceUserIds(bdb,include), /team authority unavailable/);
});
await test('People membership projection defaults to strict reads', async()=>{
 const bdb={...db,projectMembership:{findMany:async()=>{throw Error('membership read unavailable')}}};
 await assert.rejects(loadStudioAudienceUserContext(bdb,users), /membership read unavailable/);
});
const routes=readFileSync('apps/server/src/domains/library/packet-routes.ts','utf8');
await test('packet lists reuse one strict user authority and skip source-stat queries for recipients',async()=>{
 assert.match(routes,/const audienceContext = !context\.decorated\?\.isAdmin/);
 assert.match(routes,/const recipientAudienceContext = !context\.decorated\?\.isAdmin && releases\.length/);
 assert.match(routes,/const authorPacketIds = packets\.filter/);
 assert.match(routes,/childCandidates = authorPacketIds\.length/);
});
await test('recipient catalog validates immutable digest before parsing or granting audience',async()=>{
 const start=routes.indexOf('app.get("/api/packets/:packetId/deliveries/:releaseId/catalog"');
 const end=routes.indexOf('app.get("/api/packets/:packetId/releases/:releaseId/requirement-candidates"');
 const piece=routes.slice(start,end);
 assert.ok(piece.indexOf('try { packetRecipientCatalog(release); }') < piece.indexOf('const frozenAudience = publishedPacketAudience(release);'));
});
console.log(`Strict audience / Packet read optimization ${count}/${count} passed`);
