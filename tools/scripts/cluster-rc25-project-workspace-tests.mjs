import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require=createRequire(import.meta.url);
const globalNode=()=>execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim();
const ts=(()=>{try{return require('typescript')}catch{return require(`${globalNode()}/typescript`)}})();
const postcss=(()=>{try{return require('postcss')}catch{return require(`${globalNode()}/postcss`)}})();
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8');
const paths={
  browser:'packages/renderer/src/features/projects/ProjectsPage.tsx',
  tile:'packages/renderer/src/features/projects/ProjectPortfolioItem.tsx',
  header:'packages/renderer/src/features/projects/ProjectDetailHeader.tsx',
  detail:'packages/renderer/src/features/projects/ProjectDetailPage.tsx',
  overview:'packages/renderer/src/features/projects/ProjectOverviewDashboard.tsx',
  sidebar:'packages/renderer/src/features/application/modules/ApplicationSidebar.tsx',
  style:'packages/renderer/src/features/projects/projects.css',
  detailStyle:'packages/renderer/src/features/projects/project-detail-workspace.css',
};
let checks=0;
function test(label,fn){try{fn();checks++}catch(e){throw new Error(`${label}: ${e.message}`,{cause:e})}}
for(const [key,file] of Object.entries(paths)){
  const s=read(file);
  test(`parse ${key}`,()=>{
    if(file.endsWith('.css'))assert.ok(postcss.parse(s,{from:file}).nodes.length);
    else assert.equal(ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX).parseDiagnostics.length,0);
  });
}
const B=read(paths.browser),T=read(paths.tile),H=read(paths.header),D=read(paths.detail),O=read(paths.overview),S=read(paths.sidebar),C=read(paths.style),DC=read(paths.detailStyle);
const criteria=[
  ['one Projects entry',S,/onClick=\{\(\) => navigate\("projects"\)\}/],
  ['no project sidebar tree',S,/SidebarProjectItem/,'absent'],
  ['collections rail',B,/projects-browser-layout-rc25[\s\S]*projects-browser-rail-rc25/],
  ['starred collection',B,/label: "Starred"/],
  ['attention collection',B,/label: "Needs attention"/],
  ['archived collection',B,/setStatusFilter\("archived"\)/],
  ['recent collection',B,/label: "Recently updated"/],
  ['due soon',B,/label: "Due soon"/],
  ['empty filtered collection stays browser',B,/projects\.length === 0 && !portfolioProjects\.length && !projectCursor\.loading/],
  ['search keyboard opens project',B,/event\.key === "Enter" && selectedProject\) onOpenProject/],
  ['project cards first-run default',B,/useServerState<"list" \| "cards" \| "table">\("user", "projects.portfolio-view", "cards"/],
  ['details opt in',B,/\[inspectorOpen, setInspectorOpen\] = useState\(false\)/],
  ['close inspector',B,/aria-label="Close project details"/],
  ['gallery and list',B,/project-list-\$\{viewMode\}/],
  ['direct card action',T,/onClick=\{onSelect\}/],
  ['card star action',T,/onClick=\{onTogglePin\}/],
  ['card detail action',T,/onClick=\{onInspect\}/],
  ['card project color',T,/--project-row-accent/],
  ['one click table open',B,/onRowActivate=\{\(fact\) => onOpenProject/],
  ['analytics query deferred',B,/facets: analyticsOpen \?/],
  ['studio intelligence deferred',B,/!isAdmin \|\| !intelligenceOpen/],
  ['analytics disclosure',B,/onOpenChange=\{setAnalyticsOpen\}/],
  ['minimal project header',H,/project-hero-rc25/],
  ['header metadata optional',H,/<details className="project-header-details-rc25">/],
  ['header project color',H,/--project-detail-accent/],
  ['project breadcrumb',H,/project-head-breadcrumb-rc25/],
  ['overview navigates only available sections',D,/availableSections=\{tabs\.map/],
  ['overview launchpad authorized',O,/\.filter\(\(item\) => availableSections\.includes\(item\.id\)\)/],
  ['overview CTA authorized',O,/supportsReview && availableSections\.includes\("viewer"\)/],
  ['project overview current work',O,/className=\{`project-now-rc25/],
  ['optional project metrics',O,/<details className="project-overview-identity-details-rc25">/],
  ['desktop responsive rail',C,/@media\(max-width:860px\)/],
  ['phone responsive gallery',C,/@media\(max-width:580px\)/],
  ['project CSS reduced motion',C,/@media\(prefers-reduced-motion:reduce\)/],
  ['project detail mobile',DC,/@media\(max-width:580px\)/],
];
for(const [label,s,pattern,mode] of criteria)test(label,()=>mode==='absent'?assert.doesNotMatch(s,pattern):assert.match(s,pattern));
test('release metadata',()=>{const {release,sequence}=JSON.parse(read('config/release-candidate.json'));assert.ok(sequence>=25);assert.equal(release,`1.0.0-rc.${sequence}`)});
console.log(`RC25 Project Workspace Overhaul: ${checks}/${checks} focused checks passed`);
