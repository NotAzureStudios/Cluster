import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
const root=process.cwd(), checks=[], failures=[];
function check(label,ok,detail=""){checks.push({label,ok,detail});if(!ok)failures.push(label);}
const text=(relative)=>readFile(path.join(root,relative),"utf8");
async function collect(directory,out=[]){for(const entry of await readdir(directory,{withFileTypes:true})){const absolute=path.join(directory,entry.name);if(entry.isDirectory())await collect(absolute,out);else if(/\.(tsx|ts)$/.test(entry.name))out.push(absolute);}return out;}
const stateSource=await text("packages/renderer/src/components/interaction-state.ts");
const primitiveCss=await text("packages/renderer/src/styles/design-system/primitives.css");
const tokens=await text("packages/renderer/src/styles/design-system/tokens.css");
const docs=await text("docs/INTERACTION_STATE_PHASE3.md");
const architecture=await text("packages/renderer/src/styles/ARCHITECTURE.md");
const packageJson=JSON.parse(await text("package.json"));
const packager=await text("tools/scripts/package-cluster-master.mjs");
const canonical=["default","hover","focus","pressed","selected","disabled","loading","success","warning","error","offline","stale","conflict"];
for(const state of canonical) check(`canonical state exists: ${state}`,stateSource.includes(`"${state}"`));
for(const token of ["selected","success","warning","error","offline","stale","conflict"]) check(`state tokens exist: ${token}`,tokens.includes(`--cluster-state-${token}-border`)&&tokens.includes(`--cluster-state-${token}-surface`));
for(const state of ["selected","loading","success","warning","error","offline","stale","conflict"]) check(`button state styled: ${state}`,primitiveCss.includes(`data-cluster-state="${state}"`));
check("selected buttons expose aria-pressed",(await text("packages/renderer/src/components/ClusterButton.tsx")).includes("aria-pressed={selected || undefined}"));
check("loading buttons expose aria-busy",(await text("packages/renderer/src/components/ClusterButton.tsx")).includes("aria-busy={busy || undefined}"));
check("reduced motion contract exists",primitiveCss.includes("prefers-reduced-motion: reduce"));
check("state contract adds no forced overrides",!primitiveCss.slice(primitiveCss.indexOf("v0.426 interaction-state contract")).includes("!important"));
const migrations=[
 ["ClusterSelect","packages/renderer/src/components/ClusterSelect.tsx","data-cluster-state"],
 ["CompactSectionNav","packages/renderer/src/components/CompactSectionNav.tsx","data-cluster-state"],
 ["RequestState","packages/renderer/src/components/RequestState.tsx","data-cluster-state=\"error\""],
 ["AppVersionFooter","packages/renderer/src/components/AppVersionFooter.tsx","interactionState"],
 ["SyncStatusIndicator","packages/renderer/src/components/SyncStatusIndicator.tsx","interactionState"],
];
for(const [label,file,marker] of migrations) check(`${label} migrated to canonical state`,(await text(file)).includes(marker));
const sync=await text("packages/renderer/src/components/SyncStatusIndicator.tsx");
check("sync recovery uses shared actions",sync.includes("<ClusterButton")&&sync.includes("<ClusterStatus"));
const preview=await text("packages/renderer/src/components/DesignSystemPreview.tsx");
for(const state of ["success","warning","error","offline","stale","conflict"]) check(`design preview shows ${state}`,preview.includes(`state="${state}"`));
const files=await collect(path.join(root,"packages","renderer","src"));
const literalStates=new Set();
for(const file of files){const source=await readFile(file,"utf8");for(const match of source.matchAll(/data-cluster-state\s*=\s*"([^"]+)"/g))literalStates.add(match[1]);}
for(const state of literalStates) check(`literal state is canonical: ${state}`,canonical.includes(state));
check("documentation defines native pseudo-state policy",docs.includes("Do not manage pointer hover in React")&&docs.includes("data-cluster-state"));
check("renderer architecture references Phase 3",architecture.includes("Interaction state contract — Phase 3"));
check("aggregate audit includes interaction-state gate",String(packageJson.scripts?.audit||"").includes("interaction-state-audit.mjs"));
check("named interaction-state audit exists",String(packageJson.scripts?.["audit:interaction-state"]||"").includes("interaction-state-audit.mjs"));
check("master packaging invokes interaction-state audit",packager.includes("interaction-state-audit.mjs"));
check("master packaging carries Phase 3 docs",packager.includes("docs/INTERACTION_STATE_PHASE3.md"));
for(const item of checks)console.log(`${item.ok?"PASS":"FAIL"}  ${item.label}${item.detail&&!item.ok?` (${item.detail})`:""}`);
console.log(`\nInteraction state audit: ${checks.length-failures.length}/${checks.length} passed. Literal states: ${[...literalStates].sort().join(", ")||"none"}.`);
if(failures.length)process.exitCode=1;
