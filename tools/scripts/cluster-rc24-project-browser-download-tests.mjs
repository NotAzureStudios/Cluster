import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try {return require('typescript');} catch {return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript`);} })();
const postcss = (() => { try {return require('postcss');} catch {return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/postcss`);} })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
let checks=0;
const check=(callback)=>{callback();checks++;};
const sources=[
'packages/renderer/src/core/browser-download-transfers.ts',
'packages/renderer/src/core/data-export-client.ts',
'packages/renderer/src/core/storage.ts',
'packages/renderer/src/features/application/ClusterApplication.tsx',
'packages/renderer/src/features/viewer/viewer-system-integration.ts',
'packages/renderer/src/features/viewer/UnifiedPdfViewer.tsx',
'packages/renderer/src/features/packets/PacketsPage.tsx',
'packages/renderer/src/features/library/LibraryWorkspacePage.tsx',
'packages/renderer/src/components/DataExportOperationFeedback.tsx',
'packages/renderer/src/features/shell/TaskbarTransferCenter.tsx',
'packages/renderer/src/features/projects/ProjectsPage.tsx',
'packages/renderer/src/features/projects/ProjectPortfolioItem.tsx',
'packages/renderer/src/features/projects/ProjectDetailHeader.tsx',
'packages/renderer/src/features/projects/ProjectVideoWorkspace.tsx',
];
for(const source of sources){const parsed=ts.createSourceFile(source,read(source),ts.ScriptTarget.Latest,true,source.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);check(()=>assert.equal(parsed.parseDiagnostics.length,0,`${source} syntax failure`));}
for(const source of ['packages/renderer/src/features/projects/projects.css','packages/renderer/src/features/projects/project-detail-workspace.css']){check(()=>assert.ok(postcss.parse(read(source),{from:source}).nodes.length>0));}
const projects=read('packages/renderer/src/features/projects/ProjectsPage.tsx');
check(()=>assert.match(projects,/className="projects-browser-layout-rc25"/));
check(()=>assert.match(projects,/projects-browser-rail-rc25/));
check(()=>assert.match(projects,/onOpenChange=\{setAnalyticsOpen\}/));
check(()=>assert.match(projects,/\[inspectorOpen, setInspectorOpen\] = useState\(false\)/));
check(()=>assert.match(projects,/projects-browser-rc24/));
check(()=>assert.match(projects,/onInspect=\{\(\) =>/));
const video=read('packages/renderer/src/features/projects/ProjectVideoWorkspace.tsx');
check(()=>assert.match(video,/video-delivery-evidence-rc24/));
check(()=>assert.match(video,/video-upload-settings-rc24/));
const portfolioItem=read('packages/renderer/src/features/projects/ProjectPortfolioItem.tsx');
check(()=>assert.match(portfolioItem,/onClick=\{onSelect\}/));
check(()=>assert.match(portfolioItem,/onClick=\{onInspect\}>Details/));
const shell=read('packages/renderer/src/features/application/ClusterApplication.tsx');
check(()=>assert.match(shell,/screen !== "project" && contextualParent/));
const transfer=read('packages/renderer/src/features/shell/TaskbarTransferCenter.tsx');
check(()=>assert.match(transfer,/download\.state === "saved"/));
check(()=>assert.match(transfer,/Retry now/));
const exportsModule=read('packages/renderer/src/core/data-export-client.ts');
check(()=>assert.match(exportsModule,/setTimeout\(\(\) => URL\.revokeObjectURL/));
const storage=read('packages/renderer/src/core/storage.ts');
check(()=>assert.match(storage,/setTimeout\(\(\) => URL\.revokeObjectURL/));
// Exercise the actual browser transfer module against a simulated authenticated response.
const code=ts.transpileModule(read('packages/renderer/src/core/browser-download-transfers.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
let nextResponse;
const requests=[];
const clicked=[];
const revoked=[];
const delayCallbacks=[];
const document={body:{append(node){node.mounted=true;}},createElement(tag){assert.equal(tag,'a');return {mounted:false,click(){assert.equal(this.mounted,true);clicked.push({href:this.href,download:this.download});},remove(){this.mounted=false;}}}};
class FakeURL extends URL {static createObjectURL(blob){return `blob:cluster-test-${blob.size}`;}static revokeObjectURL(url){revoked.push(url);}}
const result={};
new Function('require','exports','document','window','URL','Blob','crypto','Date','Math',code)(name=>{
 if(name==='@cluster/api-client')return {clusterApiFetch:async(url,init)=>{requests.push({url,init});return nextResponse;}};
 if(name==='./api/config')return {API_URL:'http://localhost:4000'};
 throw Error('Unexpected import '+name);
},result,document,{location:{origin:'http://localhost:3000'},setTimeout:fn=>{delayCallbacks.push(fn);return 1;}},FakeURL,Blob,globalThis.crypto,Date,Math);
const fileResponse=()=>new Response(new Uint8Array([1,2,3,4]),{status:200,headers:{'content-type':'application/octet-stream','content-length':'4'}});
nextResponse=fileResponse();
const actual=await result.downloadAuthenticatedClusterFile({url:'http://localhost:4000/api/library/files/abc/download',fileName:'capture.mp4'});
check(()=>assert.equal(actual.state,'saved'));
check(()=>assert.equal(clicked[0].download,'capture.mp4'));
check(()=>assert.equal(clicked[0].href,'blob:cluster-test-4'));
check(()=>assert.equal(requests[0].url,'/api/library/files/abc/download'));
check(()=>assert.equal(requests[0].init.credentials,'include'));
check(()=>assert.equal(result.getBrowserDownloadSnapshot().length,1));
check(()=>assert.equal(revoked.length,0));
delayCallbacks.forEach(fn=>fn());
check(()=>assert.equal(revoked.length,1));
nextResponse=new Response(JSON.stringify({message:'Permission denied'}),{status:403,headers:{'content-type':'application/json'}});
await assert.rejects(()=>result.downloadAuthenticatedClusterFile({url:'http://localhost:4000/api/packets/nope/download',fileName:'blocked.zip'}),/Permission denied/);
checks++;
check(()=>assert.equal(clicked.length,1));
nextResponse=new Response('<!doctype html><title>Login</title>',{status:200,headers:{'content-type':'text/html'}});
await assert.rejects(()=>result.downloadAuthenticatedClusterFile({url:'http://localhost:4000/api/sessions/download',fileName:'login.pdf'}),/HTML page/);
checks++;
await assert.rejects(()=>result.downloadAuthenticatedClusterFile({url:'https://outside.example/api/private',fileName:'bad.zip'}),/authenticated Cluster API/);
checks++;
check(()=>assert.equal(requests.length,3));
nextResponse=new Response('placeholder',{status:200,headers:{'content-type':'application/octet-stream','content-length':String(130*1024*1024)}});
const large=await result.downloadAuthenticatedClusterFile({url:'http://localhost:4000/api/library/large',fileName:'large.zip'});
check(()=>assert.equal(large.state,'handed-off'));
check(()=>assert.equal(clicked.at(-1).href,'http://localhost:4000/api/library/large'));
check(()=>assert.equal(result.getBrowserDownloadSnapshot()[0].state,'handed-off'));
const meta=JSON.parse(read('config/release-candidate.json'));
check(()=>assert.match(meta.release,/^1\.0\.0-rc\.(?:2[5-9]|[3-9][0-9]+)$/));
console.log(`RC25 inherited project browser/download checks: ${checks}/${checks} passed`);
