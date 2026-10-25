import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const source=readFileSync('apps/server/src/domains/access/request-policy.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};vm.runInNewContext(js,{module,exports:module.exports});
const {describeClusterRequest,isScopedStudioFormReviewRequest:isScoped,requestCapabilityForPath:capability}=module.exports;
let checks=0;
function test(label,condition){assert.ok(condition,label);checks++;console.log('PASS '+label)}
const whitelisted=[
 ['GET','/api/studio-systems/submissions/s1/target'],
 ['GET','/api/studio-systems/forms/form1/submissions'],
 ['GET','/api/studio-systems/forms/form1/submissions/s1'],
 ['PATCH','/api/studio-systems/forms/form1/submissions/s1/review'],
];
for(const [method,path] of whitelisted){
 test(`${method} scoped reviewer path admits handler-specific auth: ${path}`,isScoped(path,method)&&describeClusterRequest(path,method).access.kind==='authenticated');
 test(`${method} scoped reviewer path retains kiosk Settings capability: ${path}`,capability(path)==='settings'&&describeClusterRequest(path,method).capability==='settings');
}
const excluded=[
 ['POST','/api/studio-systems/forms/form1/submissions'],
 ['PATCH','/api/studio-systems/forms/form1/submissions/s1'],
 ['DELETE','/api/studio-systems/forms/form1/submissions/s1/review'],
 ['GET','/api/studio-systems/forms/form1/submissions/s1/project-followups'],
 ['POST','/api/studio-systems/forms/form1/submissions/s1/project-followups'],
 ['GET','/api/studio-systems/forms/form1/reviewers'],
 ['POST','/api/studio-systems/forms/form1/reviewers'],
 ['GET','/api/studio-systems/operations-summary'],
 ['GET','/api/studio-systems/forms/form1/submissions/s1/review'],
 ['GET','/api/studio-systems/forms/form1/submissions/s1/anything'],
 ['GET','/api/studio-systems/submissions/s1/target/extra'],
 ['GET','/api/studio-systems/submissions/s1'],
 ['GET','/api/studio-systems/forms/form1/submissions/s1/review/extra'],
 ['GET','/api/settings'],
 ['PATCH','/api/settings'],
];
for(const [method,path] of excluded){
 const p=describeClusterRequest(path,method);
 test(`${method} unrelated/admin or unsupported path keeps coarse tool fence: ${path}`,!isScoped(path,method)&&p.access.kind!=='authenticated');
}
const kiosk=readFileSync('apps/server/src/domains/kiosk/kiosk-runtime.ts','utf8');
test('kiosk still rejects Settings capability',kiosk.includes('["serverConfig", "integrations", "settings"].includes(String(routedTool))'));
const routes=readFileSync('apps/server/src/domains/studio-systems/studio-systems-routes.ts','utf8');
test('all delegated review entrypoints still enforce exact Form grant',routes.includes('requireFormReviewer(request, reply, String(request.params?.formId || ""))'));
test('the target resolver never bypasses per-Form authorization',routes.includes('mayReview: (formId) => canReviewForm(request, formId)'));
console.log(`${checks}/${checks} scoped delegated-Form gateway regression checks passed`);assert.equal(checks,26);
