import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const code = fs.readFileSync('apps/server/src/domains/search/search-sensitive-access.ts', 'utf8');
const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
let audienceFailure = false;
vm.runInNewContext(compiled, {
  module, exports: module.exports, require: id => {
    if (id === '../access/studio-audience.js') return {
      loadStudioAudienceUserContext: async (_db, user, options) => {
        assert.equal(options.strict, true);
        if (audienceFailure) throw new Error('audience database offline');
        return { userId: user.id, memberships: ['studio-team'] };
      },
      studioAudienceMatchesContext: (raw, userId) => {
        const audience = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!audience || !['all', 'include', 'exclude'].includes(audience.mode)) throw Error('invalid audience');
        if (audience.mode !== 'all' && (!Array.isArray(audience.targets) || !audience.targets.length)) throw Error('invalid restricted audience');
        return audience.mode === 'all' || (audience.mode === 'include') === audience.targets.includes(userId);
      },
    };
    throw Error('Unexpected import: '+id);
  },
  Map, Set, Promise, Error, String, Boolean,
}, { filename: 'search-sensitive-access.ts' });
const { createSearchSensitiveAccess } = module.exports;
let passed=0;
async function check(name, run) { try { await run(); passed++; console.log('PASS',name); } catch(e) { process.exitCode=1; console.error('FAIL',name,e); } }
function fixture({admin=false, permissions=[], blockedIds=[], recordError=false, aclError=false, tool=true}={}) {
  let recordReads=0;let aclReads=0;
  const prisma = {
    personnelRecordAttachment: {
      findFirst: async ({where}) => {recordReads++;if(recordError)throw Error('Records database offline');return blockedIds.includes(where.libraryItemId)?{id:'record'}:null;},
      findMany: async ({where}) => {recordReads++;if(recordError)throw Error('Records database offline');return where.libraryItemId.in.filter(id => blockedIds.includes(id)).map(libraryItemId => ({libraryItemId}));},
    },
  };
  const libraryAccess = {
    contextForUser: async (user, _db, opts) => { aclReads++;assert.equal(opts.strict,true);if(aclError)throw Error('ACL database offline');return { userId:user.id, isAdmin:admin, permissions }; },
    visibleFor: (context, item, level) => {
      assert.equal(level,'view');
      if (context.isAdmin) return true;
      if (item.source === 'data-export' || item.source === 'data-export-root') return item.ownerId === context.userId;
      return context.permissions.includes(item.id) || context.permissions.includes(item.parentId);
    },
  };
  const adapter = createSearchSensitiveAccess({prisma,currentUser:{id:'u1'},request:{},libraryAccess,canViewTool:async()=>tool});
  const access = adapter.evaluate;
  return { access, prepareBatch:adapter.prepareBatch, counts:()=>({recordReads,aclReads}) };
}
const project={id:'P1'};
function file(id,extra={}) {return {id,kind:'file',resource:{kind:'library',id,projectId:'P1'},raw:{id,parentId:'F1',ownerId:'other',source:'manual',status:'active',...extra}};}
function packet(id, extra={}) {return {id,kind:'packet',raw:{id,libraryFolder:{id:'PACK',status:'active'},audienceJson:{mode:'all',targets:[]},...extra}};}
function policy(id, extra={}) {return {id,kind:'policy',raw:{id,audienceJson:{mode:'all',targets:[]},...extra}};}
await check('inherited folder grants authorize an indexed Library file',async()=>assert.equal(await fixture({permissions:['F1']}).access(file('A'),project),true));
await check('a Project grant cannot bypass an explicit folder denial',async()=>assert.equal(await fixture().access(file('A'),project),false));
await check('Library owner still uses the owning domain policy',async()=>assert.equal(await fixture().access(file('A',{ownerId:'u1'}),project),false));
await check('a globally indexed or mismatched Library result is denied',async()=>{
  const f=fixture({permissions:['F1']});assert.equal(await f.access(file('A'),null),false);
  assert.equal(await f.access({...file('A'),raw:{...file('A').raw,id:'other'}},project),false);
});
await check('archived, trashed and destroyed indexed items never appear',async()=>{const f=fixture({permissions:['F1']});for(const status of ['archived','trashed','destroyed'])assert.equal(await f.access(file('A',{status}),project),false);});
await check('Personnel Records attachments cannot surface for ordinary users',async()=>assert.equal(await fixture({permissions:['F1'],blockedIds:['A']}).access(file('A'),project),false));
await check('Personnel Records attachments cannot surface even for admins',async()=>assert.equal(await fixture({admin:true,blockedIds:['A']}).access(file('A'),project),false));
await check('Records lookup failure aborts disclosure',async()=>await assert.rejects(fixture({recordError:true}).access(file('A'),project),/Records database offline/));
await check('strict Library ACL database failure aborts disclosure',async()=>await assert.rejects(fixture({aclError:true}).access(file('A'),project),/ACL database offline/));
await check('a Search request coalesces duplicate Records and ACL lookups',async()=>{
  const f=fixture({permissions:['F1']});await f.access(file('A'),project);await f.access(file('A'),project);
  assert.deepEqual(f.counts(),{recordReads:1,aclReads:1});
});
await check('a private generated export is not visible through a Project grant',async()=>{
  const f=fixture({permissions:['F1']});assert.equal(await f.access(file('A',{source:'data-export'}),project),false);
  assert.equal(await f.access(file('A',{source:'data-export',ownerId:'u1'}),project),true);
});
await check('Packet requires both folder access and its current audience',async()=>{
  const f=fixture({permissions:['PACK']});assert.equal(await f.access(packet('P'),null),true);
  assert.equal(await fixture().access(packet('P'),null),false);
  assert.equal(await f.access(packet('P',{audienceJson:{mode:'include',targets:['u2']}}),null),false);
});
await check('administrator Packet search does not bypass audience rules',async()=>assert.equal(await fixture({admin:true}).access(packet('P',{audienceJson:{mode:'include',targets:['u2']}}),null),false));
await check('Packet folder must exist and be active',async()=>{
  const f=fixture({admin:true});assert.equal(await f.access(packet('P',{libraryFolder:null}),null),false);
  assert.equal(await f.access(packet('P',{libraryFolder:{id:'PACK',status:'trashed'}}),null),false);
});
await check('disabled Packet tool hides Packets and policies',async()=>{
  const f=fixture({admin:true,tool:false});assert.equal(await f.access(packet('P'),null),false);assert.equal(await f.access(policy('POL'),null),false);
});
await check('policy audience is verified for members and administrators',async()=>{
  const restricted={audienceJson:{mode:'include',targets:['u2']}};
  assert.equal(await fixture().access(policy('POL',restricted),null),false);
  assert.equal(await fixture({admin:true}).access(policy('POL',restricted),null),false);
});
await check('invalid audience metadata and failed lookups cannot grant access',async()=>{
  const f=fixture({admin:true});await assert.rejects(f.access(packet('P',{audienceJson:'invalid-json'}),null));
  audienceFailure=true;await assert.rejects(fixture({admin:true}).access(policy('POL'),null),/audience database offline/);audienceFailure=false;
});
await check('a full admission window batches protected-reference checks',async()=>{
  const f=fixture({permissions:['F1'],blockedIds:['B']});
  const items=[file('A'),file('B'),file('C')];await f.prepareBatch(items);
  assert.equal(await f.access(items[0],project),true);
  assert.equal(await f.access(items[1],project),false);
  assert.equal(await f.access(items[2],project),true);
  assert.deepEqual(f.counts(),{recordReads:1,aclReads:1});
});
await check('a failed batch reference query refuses the entire window',async()=>{
  await assert.rejects(fixture({recordError:true}).prepareBatch([file('A')]),/Records database offline/);
});
await check('unhandled resource kinds remain delegated to normal policy',async()=>assert.equal(await fixture().access({kind:'board',id:'B'},project),null));
await check('canonical Search endpoint invokes the sensitive gate before admin shortcut',async()=>{
  const routes=fs.readFileSync('apps/server/src/domains/search/search-routes.ts','utf8');
  assert.ok(routes.indexOf('const sensitiveDecision = await sensitiveAccess.evaluate(item, project);') < routes.indexOf('if (decorated?.isAdmin) return true;'));
  assert.match(routes,/if \(sensitiveDecision !== null\) return sensitiveDecision/);
  assert.match(routes,/canAccessCalendarEvent\(/);
});
await check('Library search index includes owner/source for canonical access evaluation',async()=>{
  const repo=fs.readFileSync('apps/server/src/domains/search/search-repository.ts','utf8');
  const selection=repo.split('const librarySearchSelect = {')[1].split('} as const;')[0];
  assert.match(selection,/ownerId: true/);assert.match(selection,/source: true/);
});
console.log(`${passed}/22 R47 Search domain visibility checks passed`);
if(passed!==22) process.exitCode=1;
