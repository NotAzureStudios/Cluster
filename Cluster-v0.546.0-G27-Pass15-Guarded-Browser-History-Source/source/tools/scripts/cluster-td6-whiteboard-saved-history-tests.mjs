import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root = path.resolve(import.meta.dirname, '../..');
const helperPath = path.join(root, 'apps/server/src/domains/collaboration/whiteboard-saved-history.ts');
const routePath = path.join(root, 'apps/server/src/domains/collaboration/whiteboard-operation-routes.ts');
function evaluate(file, injected = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  const use = (name) => name in injected ? injected[name] : require(name);
  new Function('require', 'module', 'exports', output)(use, mod, mod.exports);
  return mod.exports;
}
const helpers = evaluate(helperPath);
const { captureWhiteboardHistory, ensureWhiteboardHistoryNoCollision, restoreWhiteboardHistoryElements } = helpers;
let passed = 0;
async function check(label, fn) { await fn(); console.log('PASS', label); passed++; }
const elem = (x=0, id='e1', more={}) => ({ id, type: 'shape', x, y: 0, ...more });
await check('move and resize capture exact canonical before/after elements', () => {
  const data = captureWhiteboardHistory('element.move', ['e1'], [elem(0)], [elem(12)]);
  assert.deepEqual(JSON.parse(data.before).elements, [elem(0)]);
  assert.deepEqual(JSON.parse(data.after).elements, [elem(12)]);
});
await check('multi-element transforms remain one atomic history entry', () => {
  const data = captureWhiteboardHistory('batch.transform', ['e1','e2'], [elem(0),elem(1,'e2')], [elem(2),elem(3,'e2')]);
  assert.deepEqual(data.targets, ['e1','e2']);
  assert.equal(JSON.parse(data.after).elements.length,2);
});
await check('deletes, snapshot restores, settings, and create are not reversible', () => {
  for(const kind of ['element.delete','snapshot.restore','settings.patch','element.create','history.restore'])
    assert.equal(captureWhiteboardHistory(kind,['e1'],[elem(0)],[elem(5)]), null);
});
await check('no missing, duplicated or unbounded targets in reversal metadata', () => {
  assert.equal(captureWhiteboardHistory('element.patch',['e1','e1'],[elem(0)],[elem(1)]),null);
  assert.equal(captureWhiteboardHistory('element.patch',['bad'],[elem(0)],[elem(1)]),null);
  assert.equal(captureWhiteboardHistory('batch.transform',Array.from({length:101},(_,i)=>`e${i}`),[],[]),null);
});
await check('no-op element operations do not add meaningless history entries', () => {
  assert.equal(captureWhiteboardHistory('element.move', ['e1'], [elem(4)], [elem(4)]), null);
});
await check('large images do not create hidden per-operation snapshots', () => {
  assert.equal(captureWhiteboardHistory('element.patch',['e1'],[elem(0)],[elem(1,'e1',{image:'😀'.repeat(20_000)})]),null);
});
await check('undo replacement removes newly-added keys without collateral element mutation', () => {
  const elements=[elem(10,'e1',{newFlag:1}), elem(4,'e2')];
  restoreWhiteboardHistoryElements(elements,{elements:[elem(0)]},false);
  assert.deepEqual(elements[0],elem(0)); assert.deepEqual(elements[1],elem(4,'e2'));
});
await check('locked elements require manage authority even during history restore', () => {
  assert.throws(()=>restoreWhiteboardHistoryElements([elem(3,'e1',{locked:true})],{elements:[elem(0)]},false),/locked/);
  const list=[elem(3,'e1',{locked:true})]; restoreWhiteboardHistoryElements(list,{elements:[elem(0)]},true);
  assert.equal(list[0].x,0);
});
await check('malformed, duplicate and missing restoration targets fail closed', () => {
  assert.throws(()=>restoreWhiteboardHistoryElements([elem(1)],{elements:[elem(0),elem(2)]},true),/duplicate/);
  assert.throws(()=>restoreWhiteboardHistoryElements([elem(1)],{elements:[elem(0,'absent')]},true),/missing/);
  assert.throws(()=>restoreWhiteboardHistoryElements([elem(1)],{elements:[]},true),/Invalid/);
});
await check('same-target and document restores conflict; unrelated targets do not', () => {
  const rows=[{sequence:2,kind:'element.move',targets:'["e2"]'}];
  assert.equal(ensureWhiteboardHistoryNoCollision(['e1'],rows),null);
  assert.equal(ensureWhiteboardHistoryNoCollision(['e2'],rows).sequence,2);
  assert.equal(ensureWhiteboardHistoryNoCollision(['e1'],[{sequence:3,kind:'snapshot.restore',targets:'["$document"]'}]).sequence,3);
});
await check('unparseable historical targets fail closed', () => {
  assert.ok(ensureWhiteboardHistoryNoCollision(['e1'],[{sequence:2,kind:'element.patch',targets:'{invalid'}]));
});
// Run the actual registered handlers with a transaction-aware in-memory Prisma adapter.
const schemaChain = () => new Proxy({ parse(value) { return value; } }, { get(target, name) { return name in target ? target[name] : () => schemaChain(); } });
const z = { object: schemaChain, string: schemaChain, enum: schemaChain, record: schemaChain, array: schemaChain, any: schemaChain, coerce: { number: schemaChain } };
const route = evaluate(routePath, { zod: { z }, './whiteboard-saved-history.js': helpers });
function fixture({ actor='alice', modified=10, extraOps=[], historyEnabled=true }={}) {
  let role = actor;
  const base = elem(modified);
  let storage = { board: {
    id:'wb-test', projectId:null, project:null, revision:2, operationSequence:1,
    elements:JSON.stringify([base]), categories:'[]',labels:'[]',productionLinks:'{}',
    name:'Test',description:'',backgroundColor:'#fff',gridColor:'#ddd',gridStyle:'lines',canvasWidth:500,canvasHeight:500,
  }, ops: [
    {id:'operation-original-00001',whiteboardId:'wb-test',sequence:1,actorUserId:'alice',clientId:null,kind:'element.move',
      targets:'["e1"]',payload:'{"id":"e1","x":10,"y":0}',baseSequence:0,
      historyBefore:historyEnabled ? JSON.stringify({elements:[elem(0)]}) : null,
      historyAfter:historyEnabled ? JSON.stringify({elements:[elem(10)]}) : null,
      historyState:'applied',historyAnchorSequence:null,historyAction:null,historyOfId:null,createdAt:'2026-10-17T00:00:00Z'},
    ...extraOps,
  ]};
  const routes = new Map();
  const database = (get,put) => ({
    whiteboard: {
      findUnique:async ({where})=>get().board?.id===where.id ? structuredClone(get().board):null,
      findUniqueOrThrow:async ({where})=>get().board?.id===where.id ? structuredClone(get().board):Promise.reject(new Error('missing board')),
      updateMany:async ({where,data})=>{
        if (get().board.id!==where.id || get().board.revision!==where.revision || get().board.operationSequence!==where.operationSequence)return {count:0};
        const row=structuredClone(get().board);
        for(const [key,value] of Object.entries(data))row[key]=key==='revision'&&typeof value==='object'?row.revision+value.increment:value;
        put({...get(),board:row});return {count:1};
      },
    },
    whiteboardOperation: {
      findFirst:async ({where,orderBy})=>get().ops.filter(o=>o.whiteboardId===where.whiteboardId).sort((a,b)=>a.sequence-b.sequence)[0]||null,
      findUnique:async ({where})=>structuredClone(get().ops.find(o=>o.id===where.id)||null),
      findMany:async ({where={},orderBy,take,select})=>{
        let v=get().ops.filter(o=>(!where.whiteboardId||o.whiteboardId===where.whiteboardId)&&(!where.actorUserId||o.actorUserId===where.actorUserId));
        if(where.id?.in)v=v.filter(o=>where.id.in.includes(o.id));
        if(where.sequence?.gt!==undefined)v=v.filter(o=>o.sequence>where.sequence.gt);
        if(where.historyBefore?.not===null)v=v.filter(o=>o.historyBefore!==null);
        if(where.historyAction===null)v=v.filter(o=>o.historyAction===null);
        v=v.sort((a,b)=>orderBy?.sequence==='desc'?b.sequence-a.sequence:a.sequence-b.sequence);
        return structuredClone(take?v.slice(0,take):v);
      },
      create:async ({data})=>{put({...get(),ops:[...get().ops,{...structuredClone(data),historyBefore:null,historyAfter:null,historyState:'applied',historyAnchorSequence:null,createdAt:'2026-10-17T00:01:00Z'}]});return data;},
      createMany:async ({data})=>{put({...get(),ops:[...get().ops,...data.map(row=>({
        ...structuredClone(row),historyState:'applied',historyAnchorSequence:null,historyAction:null,createdAt:'2026-10-17T00:01:00Z',
      }))]});return {count:data.length};},
      updateMany:async ({where,data})=>{
        const match=get().ops.find(o=>o.id===where.id&&o.historyState===where.historyState&&o.historyAnchorSequence===where.historyAnchorSequence);
        if(!match)return {count:0};
        put({...get(),ops:get().ops.map(o=>o.id===where.id?{...o,...structuredClone(data)}:o)});return {count:1};
      },
    },
  });
  const prisma={
    ...database(()=>storage,v=>{storage=v}),
    async $transaction(fn) {let staged=structuredClone(storage);const result=await fn(database(()=>staged,v=>{staged=v}));storage=staged;return result;},
  };
  route.registerWhiteboardOperationRoutes({
    app:{get:(endpoint,handler)=>routes.set(`GET ${endpoint}`,handler),post:(endpoint,handler)=>routes.set(`POST ${endpoint}`,handler)},
    prisma,
    getCurrentUser:async()=>({id:role}),
    enforceTargetAccess:async()=>true,
    authorization:{requireTool:async()=>true,authorize:async()=>({allowed:true})},
    collaborationRuntime:{scheduleBroadcast:()=>{}},
    serializeWhiteboard:row=>({...row,elements:JSON.parse(row.elements)}),
    logActivity:async()=>{},
  });
  const invoke=async(method,endpoint,params={})=>{
    const handler=routes.get(`${method} ${endpoint}`);assert.ok(handler,`${method} ${endpoint}`);
    let status=200;const reply={code(n){status=n;return this;},send(body){return body;}};
    const body=await handler({params},reply);
    return {status,body};
  };
  const save=async(operations,baseSequence=storage.board.operationSequence)=>{
    const handler=routes.get('POST /api/whiteboards/:whiteboardId/operations');
    let status=200; const reply={code(n){status=n;return this;},send(body){return body;}};
    return {status,body:await handler({params:{whiteboardId:'wb-test'},body:{baseSequence,clientId:'client-A',operations}},reply)};
  };
  const act=(direction,operationId='operation-original-00001')=>invoke('POST','/api/whiteboards/:whiteboardId/history/:operationId/:direction',{whiteboardId:'wb-test',operationId,direction});
  const history=()=>invoke('GET','/api/whiteboards/:whiteboardId/history',{whiteboardId:'wb-test'});
  return {act,history,save,setActor:id=>{role=id},get state(){return storage},mutate:fn=>fn(storage)};
}
await check('POST operations persists before/after metadata and supports a real saved Undo round trip',async()=>{
  const fx=fixture();
  const operationId='new-saved-move-000002';
  const result=await fx.save([{id:operationId,kind:'element.move',payload:{id:'e1',x:18,y:0}}]);
  assert.equal(result.status,200);
  assert.equal(JSON.parse(fx.state.board.elements)[0].x,18);
  const recorded=fx.state.ops.find(row=>row.id===operationId);
  assert.deepEqual(JSON.parse(recorded.historyBefore).elements,[elem(10)]);
  assert.deepEqual(JSON.parse(recorded.historyAfter).elements,[elem(18)]);
  assert.equal((await fx.act('undo',operationId)).status,200);
  assert.equal(JSON.parse(fx.state.board.elements)[0].x,10);
});
await check('author can undo a committed saved move atomically',async()=>{
  const fx=fixture();const response=await fx.act('undo');
  assert.equal(response.status,200);assert.equal(fx.state.board.operationSequence,2);assert.equal(fx.state.board.revision,3);
  assert.equal(JSON.parse(fx.state.board.elements)[0].x,0);
  assert.equal(fx.state.ops[0].historyState,'undone');assert.equal(fx.state.ops[1].kind,'history.restore');
  assert.equal(fx.state.ops[1].historyOfId,'operation-original-00001');
});
await check('redo restores the canonical committed shape, still through realtime log',async()=>{
  const fx=fixture();await fx.act('undo');const response=await fx.act('redo');
  assert.equal(response.status,200);assert.equal(JSON.parse(fx.state.board.elements)[0].x,10);
  assert.equal(fx.state.board.operationSequence,3);assert.equal(fx.state.ops[0].historyState,'applied');
  assert.equal(fx.state.ops[2].historyAction,'redo');
});
await check('double Undo is rejected without writing another operation',async()=>{
  const fx=fixture();await fx.act('undo');const response=await fx.act('undo');
  assert.equal(response.status,409);assert.equal(response.body.code,'WHITEBOARD_HISTORY_STATE');assert.equal(fx.state.ops.length,2);
});
await check('another actor cannot reverse original editor history',async()=>{
  const fx=fixture();fx.setActor('bob');const response=await fx.act('undo');
  assert.equal(response.status,403);assert.equal(response.body.code,'WHITEBOARD_HISTORY_NOT_AUTHOR');assert.equal(fx.state.ops.length,1);
});
await check('history listing is private to the current author',async()=>{
  const fx=fixture();assert.equal((await fx.history()).body.entries.length,1);
  fx.setActor('bob');assert.equal((await fx.history()).body.entries.length,0);
});
await check('same target modified after original blocks Undo',async()=>{
  const fx=fixture();fx.mutate(s=>{s.ops.push({sequence:2,whiteboardId:'wb-test',id:'newer-target',targets:'["e1"]',kind:'element.move'});s.board.operationSequence=2;});
  const result=await fx.act('undo');assert.equal(result.status,409);assert.equal(result.body.code,'WHITEBOARD_HISTORY_CONFLICT');
});
await check('unrelated newer edits do not block target-specific Undo',async()=>{
  const fx=fixture();fx.mutate(s=>{s.ops.push({sequence:2,whiteboardId:'wb-test',id:'newer-other',targets:'["e2"]',kind:'element.move'});s.board.operationSequence=2;});
  const result=await fx.act('undo');assert.equal(result.status,200);assert.equal(fx.state.board.operationSequence,3);
});
await check('intervening collaborative changes after Undo block Redo',async()=>{
  const fx=fixture();await fx.act('undo');
  fx.mutate(s=>{s.ops.push({sequence:3,whiteboardId:'wb-test',id:'after-undo',targets:'["e1"]',kind:'element.patch'});s.board.operationSequence=3;});
  const result=await fx.act('redo');assert.equal(result.status,409);assert.equal(result.body.code,'WHITEBOARD_HISTORY_CONFLICT');
});
await check('compaction gaps are never assumed collision-free',async()=>{
  const fx=fixture();fx.mutate(s=>{s.ops[0].historyAnchorSequence=1;s.ops.push({id:'newer',whiteboardId:'wb-test',sequence:3,targets:'["e2"]'});s.board.operationSequence=3;});
  // A genuine missing tail is discovered even if the remaining events are unrelated.
  const response=await fx.act('undo');assert.equal(response.status,409);assert.equal(response.body.code,'WHITEBOARD_HISTORY_GAP');
});
await check('direct writes bypassing the operation feed cannot be erased',async()=>{
  const fx=fixture({modified:90});const result=await fx.act('undo');
  assert.equal(result.status,409);assert.equal(result.body.code,'WHITEBOARD_HISTORY_STATE_CHANGED');
});
await check('nonreversible operations cannot enter the inverse endpoint',async()=>{
  const fx=fixture({historyEnabled:false});const result=await fx.act('undo');
  assert.equal(result.status,404);assert.equal(result.body.code,'WHITEBOARD_HISTORY_NOT_FOUND');
});
await check('unavailable or wrong Whiteboard operation IDs cannot be reversed',async()=>{
  const fx=fixture();assert.equal((await fx.act('undo','absent-operation')).status,404);
});
await check('manual changes to original history are protected by state checks',async()=>{
  const fx=fixture();await fx.act('undo');fx.mutate(s=>{s.ops[0].historyState='applied'});
  const result=await fx.act('redo');assert.equal(result.status,409);
});
const renderer = fs.readFileSync(path.join(root,'packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx'),'utf8');
const operations = fs.readFileSync(path.join(root,'packages/renderer/src/features/whiteboards/whiteboard-operations.ts'),'utf8');
await check('renderer uses online server-owned saved Undo, not queued snapshot inverses',()=>{
  assert.ok(renderer.includes('/history/${encodeURIComponent(entry.id)}/${direction}'));
  assert.ok(!renderer.includes('buildWhiteboardOperations(saved, baseWhiteboard)'));
  assert.ok(!renderer.includes('freshWhiteboardOperations('));
  assert.ok(operations.includes('operation.kind === "history.restore"'));
});
await check('normal batch schema does not admit private history.restore kind',()=>{
  const server=fs.readFileSync(routePath,'utf8');
  const allowed=server.slice(server.indexOf('const operationKindSchema'),server.indexOf('const operationSchema'));
  assert.ok(!allowed.includes('history.restore'));
  assert.ok(server.includes('actorUserId !== user.id'));
  assert.ok(server.includes('revision: current.revision, operationSequence: current.operationSequence'));
});
console.log(`${passed}/${passed} TD6 F04 source and transaction-harness checks passed`);
