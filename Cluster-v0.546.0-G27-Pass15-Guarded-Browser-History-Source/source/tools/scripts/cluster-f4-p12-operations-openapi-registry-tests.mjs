import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root=path.resolve(import.meta.dirname,'../..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const src=read('apps/server/src/app/server-routes-health-operations.ts');
const openapi=read('apps/server/src/core/openapi.ts');
let n=0;const yes=(b,name)=>{assert.ok(b,name);n++};const eq=(a,b,name)=>{assert.deepEqual(a,b,name);n++};
const registered=[...src.matchAll(/app\.(get|post|patch|put|delete)\("(\/api\/admin\/operations\/[^"]+)"/g)];
yes(registered.length>=15,'operations route coverage');
for(const match of registered){
 const [,method,registeredPath]=match;
 const canonical=registeredPath.replace(/:([a-zA-Z]+)\b/g,(_,name)=>`{${name}}`);
 const anchor=`"${canonical}":`;
 const start=openapi.indexOf(anchor);
 yes(start>=0,`${method.toUpperCase()} ${registeredPath} documented`);
 const end=openapi.indexOf('\n      "',start+anchor.length);
 const declaration=openapi.slice(start,end<0?start+500:end);
 yes(new RegExp(`\\b${method}:`).test(declaration),`${method.toUpperCase()} ${registeredPath} method documented`);
}
const required=[
 ['get','/api/admin/operations/maintenance/preflight'],
 ['post','/api/admin/operations/acceleration/compatibility-check'],
 ['get','/api/admin/operations/storage-lifecycle'],
 ['post','/api/admin/operations/storage-lifecycle/run'],
 ['get','/api/admin/operations/integrity'],
 ['post','/api/admin/operations/integrity/refresh'],
];
for(const [method,route] of required){
 yes(src.includes(`app.${method}("${route}"`),`route exists ${route}`);
 yes(openapi.includes(`"${route}": { ${method}: operation(`),`documented endpoint ${route}`);
}
for(const [route,method] of [['/api/admin/operations/storage-lifecycle','get'],['/api/admin/operations/integrity','get']]){
 const i=openapi.indexOf(`"${route}":`);
 const block=openapi.slice(i,openapi.indexOf('\n      "',i+1));
 eq(block.includes('post: operation('),false,`snapshot route cannot advertise a write verb`);
}
const compiled=ts.transpileModule(openapi,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
eq(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,'OpenAPI source compiles');
console.log(`${n}/${n} F4 P12 Operations OpenAPI route inventory assertions passed`);
