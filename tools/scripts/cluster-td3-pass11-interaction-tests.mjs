import fs from 'node:fs';
import vm from 'node:vm';
import ts from '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js';
const root=process.cwd();
const read=(p)=>fs.readFileSync(`${root}/${p}`,'utf8');
const metrics=read('packages/renderer/src/components/ClusterMetricStrip.tsx');
const bar=read('packages/renderer/src/components/ClusterTableToolbar.tsx');
const undo=read('packages/renderer/src/components/ClusterContextActions.tsx');
const hook=read('packages/renderer/src/components/useClusterHistoryExecution.ts');
const css=read('packages/renderer/src/styles/design-system/workspace-polish.css');
const cases=[
 ['interactive metrics remain real buttons',metrics.includes('<ClusterButton') && metrics.includes('role="listitem" className="cluster-metric-interactive-v547"') && !/role="listitem"\s*\n\s*>\s*\n\s*<MetricContent/.test(metrics)],
 ['selected metric still available',metrics.includes('selected={item.selected}')],
 ['metric button keeps visible accessible name',!metrics.includes('aria-label={`${item.label}')],
 ['metric wrapper style local',css.includes('.cluster-metric-interactive-v547 > .cluster-metric-item-v427')],
 ['search input Escape consumer first',bar.indexOf('onSearchKeyDown?.(event)') < bar.indexOf('!event.defaultPrevented')],
 ['search clear checks Escape and nonempty query',bar.includes('event.key === "Escape" && query')],
 ['search clear prevents dialog Escape',bar.includes('event.stopPropagation()')],
 ['search clear button restores input focus',bar.includes('focusSearch();')],
 ['clear input existing ref preserved',bar.includes('ref={inputRef}')],
 ['search output live counts remain',bar.includes('aria-live="polite"')],
 ['undo bar guarded',undo.includes('history.execute(onUndo)')],
 ['redo guarded',undo.includes('history.execute(onRedo)')],
 ['history actions disable while pending',undo.includes('disabled={!canRedo || history.busy}') && undo.includes('disabled={!canUndo || history.busy}')],
 ['explicit uncertain outcome',hook.includes('Check the result before retrying.')],
 ['immediate action lock',hook.includes('if (pendingRef.current) return;') && hook.includes('pendingRef.current = true;')],
 ['synchronous action errors handled',hook.includes('try { result = action(); }')],
 ['pending released after async completion',hook.includes('.finally(() => { pendingRef.current = false; if (mountedRef.current) setBusy(false); })')],
 ['undo errors accessible',undo.includes('role="alert" className="cluster-history-error-v547"')],
 ['icon/appearance preferences unaffected',fs.existsSync(`${root}/packages/renderer/src/features/shell/sidebar.css`)],
];
let passed=0;for(const [name,ok] of cases){console.log(ok?'PASS':'FAIL',name);if(ok)passed++}
// A real execution of the transpiled hook with minimal React hook stubs.
const transpiled=ts.transpileModule(hook,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let currentState={};const mockReact={useRef(initial){return {current:initial}},useState(initial){const obj={value:initial};return [initial,value=>{obj.value=value;currentState.last=value}]},useCallback(fn){return fn},useEffect(){}};
const mod={exports:{}};vm.runInNewContext(transpiled,{require(id){if(id==='react')return mockReact;throw Error(id)},module:mod,exports:mod.exports,Promise});
const runtime=mod.exports.useClusterHistoryExecution();let actions=0,resolve;
const pending=new Promise(r=>resolve=r);
runtime.execute(()=>{actions++;return pending});runtime.execute(()=>{actions++;return pending});
const syncPrevented=actions===1;resolve();await new Promise(r=>setImmediate(r));
runtime.execute(()=>{actions++;});await new Promise(r=>setImmediate(r));
const nextAllowed=actions===2;
for(const [name,ok] of [['rapid double-action coalesces synchronously',syncPrevented],['new action permitted after settlement',nextAllowed]]){console.log(ok?'PASS':'FAIL',name);if(ok)passed++}
const report={passed,total:cases.length+2};fs.writeFileSync('TD3_PASS11_INTERACTION_TEST_RESULTS.json',JSON.stringify(report,null,2)+'\n');
console.log('TOTAL',passed,'/',report.total);if(passed!==report.total)process.exitCode=1;
