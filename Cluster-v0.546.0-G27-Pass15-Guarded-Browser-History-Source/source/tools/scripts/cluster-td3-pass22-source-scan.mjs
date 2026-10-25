/** Source-development smoke check; not full dependency-backed compile or certification. */
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root=path.resolve(import.meta.dirname,'../..');const exts=['.ts','.tsx'];
const walk=(dir,fn)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='node_modules'||e.name.startsWith('.'))continue;const p=path.join(dir,e.name);if(e.isDirectory())walk(p,fn);else if(e.isFile())fn(p);}};
const result={typescriptFiles:0,syntaxErrors:[],rendererImports:0,missingImports:[],cssFiles:0,cssBraceErrors:[]};
for(const dir of ['packages','apps'])walk(path.join(root,dir),p=>{
 if(exts.includes(path.extname(p))){const source=fs.readFileSync(p,'utf8');result.typescriptFiles++;const ast=ts.createSourceFile(p,source,ts.ScriptTarget.Latest,true,p.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);if(ast.parseDiagnostics.length)result.syntaxErrors.push(...ast.parseDiagnostics.map(x=>`${path.relative(root,p)}:${x.start}:${ts.flattenDiagnosticMessageText(x.messageText,' ')}`));
 if(p.includes('/packages/renderer/')){for(const m of source.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)){result.rendererImports++;const base=path.resolve(path.dirname(p),m[1]);if(![base,...['.ts','.tsx','.js','.jsx','.mjs','.json'].map(x=>base+x),...['index.ts','index.tsx','index.js'].map(x=>path.join(base,x))].some(x=>fs.existsSync(x)))result.missingImports.push(`${path.relative(root,p)} :: ${m[1]}`);}}}
 else if(path.extname(p)==='.css'){result.cssFiles++;const contents=fs.readFileSync(p,'utf8').replace(/\/\*[\s\S]*?\*\//g,'');let balance=0;for(const c of contents){if(c==='{')balance++;if(c==='}')balance--;if(balance<0)break;}if(balance!==0)result.cssBraceErrors.push(path.relative(root,p));}
});
fs.writeFileSync(path.join(root,'TD3_PASS22_SOURCE_SCAN.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({typescriptFiles:result.typescriptFiles,syntaxErrors:result.syntaxErrors.length,rendererImports:result.rendererImports,missingImports:result.missingImports.length,cssFiles:result.cssFiles,cssBraceErrors:result.cssBraceErrors.length}));
if(result.syntaxErrors.length||result.missingImports.length||result.cssBraceErrors.length)process.exitCode=1;
