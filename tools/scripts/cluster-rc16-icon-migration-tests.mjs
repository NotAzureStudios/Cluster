// RC16 complete icon migration gate: all semantic names resolve through
// Phosphor Duotone, Tabler, or Lucide. No Coolicons and no runtime CDN.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compile, expand, iconCandidates, names} from './generate-cluster-icons.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const iconBoundary=read('packages/renderer/src/components/ClusterIcon.tsx');
const tsUnion=iconBoundary.match(/export type ClusterIconName\s*=([\s\S]*?);/)?.[1]||'';
const declared=[...tsUnion.matchAll(/\| "([^\"]+)"/g)].map(x=>x[1]);
assert.equal(declared.length,names.length,'Catalog list must cover every component name');
assert.deepEqual([...declared].sort(),[...names].sort(),'No missing semantic names');
assert.equal(new Set(names).size,names.length,'Icon names must be unique');
assert.ok(names.length>=79);
for(const name of names)assert.ok(iconCandidates.lucide[name]||iconCandidates.tabler[name]||iconCandidates.ph[name],`no vendor mapping for ${name}`);
const all=Object.fromEntries(Object.entries(iconCandidates).map(([pack,mappings])=>[pack,{width:24,height:24,icons:Object.fromEntries(Object.values(mappings).map(name=>[name,{body:'<path d="M2 2L8 8"/>'}]))}]));
const result=compile(all);
assert.deepEqual(result.uncovered,[]);
assert.ok(result.included.ph>=40 && result.included.tabler>=50 && result.included.lucide>=79);
assert.ok(result.catalog['ph:star-filled'],'filled state must have an actual filled option');
assert.ok(result.catalog['tabler:home'] && result.catalog['lucide:close']);
const reduced=structuredClone(all);
delete reduced.lucide.icons[iconCandidates.lucide.keyboard];
const fallback=compile(reduced);
assert.ok(fallback.uncovered.includes('keyboard'),'coverage gate must reject missing symbols');
// transformed aliases must not corrupt shapes or orient arrows incorrectly.
assert.equal(expand({icons:{up:{body:'<path/>'}},aliases:{down:{parent:'up',rotate:2}}},'down'),null);
assert.ok(!iconBoundary.includes('@iconify-json/ci'));
assert.ok(!iconBoundary.includes('CoolIcon'));
assert.match(iconBoundary,/data-icon-pack=\{result.pack\}/);
assert.match(iconBoundary,/treatment \?\? \(identityNames\.has\(name\) \? "duotone" : "action"\)/);
assert.match(iconBoundary,/priority = name === "star-filled"/);
assert.match(read('packages/renderer/src/features/shell/ShellPrimitives.tsx'),/treatment=\{active \? "duotone" : nested \? "navigation" : "duotone"\}/);
const pkg=JSON.parse(read('packages/renderer/package.json'));
for(const dep of ['@iconify-json/ph','@iconify-json/tabler','@iconify-json/lucide']) {
 assert.ok(pkg.devDependencies[dep],`${dep} should be build-time only`);
 assert.ok(!pkg.dependencies[dep],`${dep} should not ship with the running application`);
}
assert.ok(!pkg.dependencies['@iconify-json/ci'],'obsolete icon package still installed');
const scripts=JSON.parse(read('package.json')).scripts;
for(const script of ['dev','dev:web','build:web'])assert.match(scripts[script],/icons:generate/);
assert.match(read('packages/renderer/src/styles/design-system/primitives.css'),/RC16: application-wide three-pack optical alignment/);
const folder=path.join(root,'packages/renderer/src');let usages=0;
function walk(d){for(const item of fs.readdirSync(d,{withFileTypes:true})) {const name=path.join(d,item.name);if(item.isDirectory())walk(name);else if(item.isFile()&&/\.tsx?$/.test(item.name)){
 const body=fs.readFileSync(name,'utf8');
 if(item.name!=='ClusterIcon.tsx'){
  assert.ok(!/\bCoolIcon\b/.test(body),`obsolete icon import at ${name}`);
  assert.ok(!/\@iconify-json\/(?:ci|lucide|tabler|ph)/.test(body),`icon library imported outside boundary at ${name}`);
  usages+=(body.match(/<ClusterIcon\b/g)||[]).length;
 }
}}}
walk(folder);
assert.ok(usages>=300,`too few uses of shared icon boundary (${usages})`);
const meta=JSON.parse(read('config/release-candidate.json'));
assert.ok(meta.release.startsWith("1.0.0-rc.") && meta.sequence >= 16, "Complete icon migration must persist");
console.log(`RC16 icon migration: ${names.length} semantic names, ${usages} shared uses; Phosphor/Tabler/Lucide offline-only; no legacy pack`);
